import { useEffect, useId, useRef, useState } from 'preact/hooks';
import {
  LIMITS,
  ValidationError,
  formatDuration,
  type Category,
  type CategoryColorSlot,
  type Task,
} from '@core';
import { CAT_NAMES, categoryOf, doneTasks, liveCategories, openTasks } from '../app/selectors';
import { clockTick, core, data } from '../app/coreBridge';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { Button, IconButton, Menu, Select } from '../components/ui';

function errorText(e: unknown, what: 'task' | 'category'): string {
  if (e instanceof ValidationError) {
    if (e.reason === 'too-long')
      return what === 'task'
        ? 'Task names can be up to 80 characters.'
        : 'Category names can be up to 30 characters.';
    if (e.reason === 'limit') return 'You can have up to 8 categories.';
    if (e.reason === 'last-category') return 'Keep at least one category.';
    return what === 'task' ? 'Enter a task name.' : 'Enter a category name.';
  }
  throw e;
}

export function Swatch({ slot, size = 10 }: { slot: number; size?: number }) {
  return (
    <span
      class="swatch"
      style={{ width: `${size}px`, height: `${size}px`, background: `var(--em-cat-${slot})` }}
      aria-hidden="true"
    />
  );
}

function SwatchPicker({
  value,
  onPick,
  label,
}: {
  value: number;
  onPick: (s: CategoryColorSlot) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
      const i = els.indexOf(document.activeElement as HTMLElement);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      els[(i + d + els.length) % els.length]?.focus();
    }
  };
  return (
    <div class="swatchpick" ref={root} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        class="swatchbtn"
        aria-label={`${label}: ${CAT_NAMES[value - 1]}. Change color`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Swatch slot={value} size={18} />
      </button>
      {open ? (
        <div class="popover swatchpop" role="radiogroup" aria-label="Category color">
          {CAT_NAMES.map((n, i) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === i + 1}
              aria-label={n}
              class="swatchopt"
              onClick={() => {
                onPick((i + 1) as CategoryColorSlot);
                setOpen(false);
                btn.current?.focus();
              }}
            >
              <span class="swatchopt__dot" style={{ background: `var(--em-cat-${i + 1})` }}>
                {value === i + 1 ? <Icon name="check" size={16} /> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddTask() {
  const d = data.value;
  const cats = liveCategories(d);
  const stored = d.meta.lastCategoryId;
  const defaultCat = cats.find((c) => c.id === stored)?.id ?? cats[0]?.id ?? '';
  const [name, setName] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = cat && cats.some((c) => c.id === cat) ? cat : defaultCat;
  const submit = (e: Event) => {
    e.preventDefault();
    try {
      core.store.addTask({ name, categoryId: selected });
      setName('');
      setErr('');
      inputRef.current?.focus();
    } catch (x) {
      setErr(errorText(x, 'task'));
    }
  };
  return (
    <form class="addtask" onSubmit={submit} novalidate>
      <div class="addtask__name field">
        <label for="task-name" class="field__label">
          New task
        </label>
        <input
          id="task-name"
          ref={inputRef}
          class="input"
          data-testid="task-add-input"
          value={name}
          maxLength={LIMITS.taskName[1]}
          placeholder="What are you working on?"
          autoComplete="off"
          aria-describedby={err ? 'task-err' : undefined}
          aria-invalid={err ? true : undefined}
          onInput={(e) => {
            setName((e.target as HTMLInputElement).value);
            setErr('');
          }}
        />
      </div>
      <div class="addtask__row">
        <Select
          label="Category"
          id="task-cat"
          testid="task-add-category"
          value={selected}
          onChange={setCat}
          options={cats.map((c) => ({ value: c.id, label: c.name }))}
          class="addtask__cat"
        />
        <Button variant="primary" type="submit" data-testid="task-add-button" class="addtask__btn">
          Add
        </Button>
      </div>
      {err ? (
        <p class="error addtask__err" id="task-err">
          {err}
        </p>
      ) : null}
    </form>
  );
}

function TaskRow({
  task,
  onDelete,
  onCategory,
}: {
  task: Task;
  onDelete: (t: Task) => void;
  onCategory: (t: Task) => void;
}) {
  void clockTick.value;
  const d = data.value;
  const cat = categoryOf(d, task);
  const isCur = d.meta.currentTaskId === task.id;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.name);
  const [err, setErr] = useState('');
  const mins = core.select.taskWeekMs(task.id);
  const id = useId();
  const save = () => {
    try {
      core.store.updateTask(task.id, { name: text });
      setEditing(false);
      setErr('');
    } catch (x) {
      setErr(errorText(x, 'task'));
    }
  };
  return (
    <li
      class={`trow${isCur ? ' trow--cur' : ''}${task.done ? ' trow--done' : ''}`}
      data-testid="task-row"
      data-task-id={task.id}
    >
      <label class="check">
        <input
          type="checkbox"
          checked={task.done}
          aria-label={`${task.done ? 'Mark not done' : 'Mark done'}: ${task.name}`}
          onChange={(e) => core.store.setTaskDone(task.id, (e.target as HTMLInputElement).checked)}
        />
        <span class="check__box">
          <Icon name="check" size={14} />
        </span>
      </label>
      <div class="trow__main">
        {editing ? (
          <form
            class="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label class="sr-only" for={id}>
              Task name
            </label>
            <input
              id={id}
              class="input"
              data-autofocus
              value={text}
              maxLength={LIMITS.taskName[1]}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditing(false);
                  setText(task.name);
                  setErr('');
                }
              }}
              ref={(el) => el?.focus()}
            />
            <Button variant="secondary" type="submit">
              Save
            </Button>
            {err ? <p class="error">{err}</p> : null}
          </form>
        ) : (
          <>
            <div class="trow__name" title={task.name}>
              {task.name}
              {isCur ? <span class="chip">Current</span> : null}
            </div>
            <div class="trow__cat">
              <Swatch slot={cat.color} />
              <span>{cat.name}</span>
              <span class="trow__catmins">· {formatDuration(mins)}<span class="sr-only"> this week</span></span>
            </div>
          </>
        )}
      </div>
      <div class="trow__mins" title="Focus time this week">
        {formatDuration(mins)}
        <span class="sr-only"> this week</span>
      </div>
      <IconButton
        icon={isCur ? 'target-fill' : 'target'}
        label={isCur ? `Current task: ${task.name}. Clear` : `Set as current: ${task.name}`}
        tip={isCur ? 'Current task' : 'Set as current'}
        aria-pressed={isCur}
        class={isCur ? 'iconbtn--on' : ''}
        onClick={() => core.store.setCurrentTask(isCur ? null : task.id)}
      />
      <Menu
        label={`More actions for ${task.name}`}
        items={[
          {
            label: 'Rename',
            onSelect: () => {
              setText(task.name);
              setEditing(true);
            },
          },
          { label: 'Change category', onSelect: () => onCategory(task) },
          { label: 'Delete', danger: true, onSelect: () => onDelete(task) },
        ]}
      />
    </li>
  );
}

function CategoryRow({ cat, onDelete }: { cat: Category; onDelete: (c: Category) => void }) {
  const [name, setName] = useState(cat.name);
  const [err, setErr] = useState('');
  useEffect(() => setName(cat.name), [cat.name]);
  const commit = () => {
    if (name.trim() === cat.name) {
      setName(cat.name);
      setErr('');
      return;
    }
    try {
      core.store.updateCategory(cat.id, { name });
      setErr('');
    } catch (x) {
      setErr(errorText(x, 'category'));
    }
  };
  const nid = useId();
  const single = liveCategories(data.value).length <= 1;
  return (
    <li class="crow" data-testid="category-row">
      <SwatchPicker
        value={cat.color}
        label={cat.name}
        onPick={(s) => core.store.updateCategory(cat.id, { color: s })}
      />
      <label class="sr-only" for={nid}>
        Category name
      </label>
      <input
        id={nid}
        class="input input--quiet"
        value={name}
        maxLength={LIMITS.categoryName[1]}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setName(cat.name);
        }}
      />
      <IconButton
        icon="trash"
        label={`Delete category ${cat.name}`}
        tip={single ? 'Keep at least one category' : 'Delete category'}
        disabled={single}
        onClick={() => onDelete(cat)}
      />
      {err ? <p class="error crow__err">{err}</p> : null}
    </li>
  );
}

function Categories({ onDelete }: { onDelete: (c: Category) => void }) {
  const newId = useId();
  const d = data.value;
  const cats = liveCategories(d);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const add = (e: Event) => {
    e.preventDefault();
    try {
      const used = new Set(cats.map((c) => c.color));
      const slot = ([1, 2, 3, 4, 5, 6, 7, 8] as CategoryColorSlot[]).find((s) => !used.has(s)) ?? 1;
      core.store.addCategory({ name, color: slot });
      setName('');
      setErr('');
    } catch (x) {
      setErr(errorText(x, 'category'));
    }
  };
  return (
    <>
      <ul class="clist">
        {cats.map((c) => (
          <CategoryRow key={c.id} cat={c} onDelete={onDelete} />
        ))}
      </ul>
      <form class="inline-form catadd" onSubmit={add} novalidate>
        <label class="sr-only" for={newId}>
          New category name
        </label>
        <input
          id={newId}
          class="input"
          value={name}
          maxLength={LIMITS.categoryName[1]}
          placeholder={cats.length >= LIMITS.categories[1] ? 'Category limit reached' : 'New category'}
          disabled={cats.length >= LIMITS.categories[1]}
          onInput={(e) => {
            setName((e.target as HTMLInputElement).value);
            setErr('');
          }}
        />
        <Button variant="secondary" type="submit" disabled={cats.length >= LIMITS.categories[1]}>
          Add category
        </Button>
      </form>
      {err ? <p class="error">{err}</p> : null}
    </>
  );
}

export function Tasks() {
  const d = data.value;
  const open = openTasks(d);
  const done = doneTasks(d);
  const [showDone, setShowDone] = useState(false);
  const [del, setDel] = useState<Task | null>(null);
  const [recat, setRecat] = useState<Task | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const [clearing, setClearing] = useState(false);
  const [manage, setManage] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const cats = liveCategories(d);
  const askDeleteCat = (c: Category) => {
    setMoveTo(cats.find((x) => x.id !== c.id)?.id ?? '');
    setDelCat(c);
  };

  return (
    <div class="page page--tasks">
      <div class="pagehead">
        <h1 class="pagehead__title">Tasks</h1>
        <Button variant="secondary" class="only-phone" onClick={() => setManage(true)}>
          Manage categories
        </Button>
      </div>
      <div class="tasks-grid">
        <div class="tasks-grid__main">
          <div class="card">
            <AddTask />
          </div>
          <div class="card card--flush">
            {open.length === 0 ? (
              <div class="empty">
                <p class="empty__title">Nothing here yet.</p>
                <p class="empty__text">Add what you're working on.</p>
              </div>
            ) : (
              <ul class="tlist" aria-label="Open tasks">
                {open.map((t) => (
                  <TaskRow key={t.id} task={t} onDelete={setDel} onCategory={setRecat} />
                ))}
              </ul>
            )}
          </div>
          {done.length > 0 ? (
            <div class="card card--flush">
              <div class="donehead">
                <button
                  type="button"
                  class="donehead__toggle"
                  aria-expanded={showDone}
                  aria-controls="done-list"
                  onClick={() => setShowDone(!showDone)}
                >
                  <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size={16} />
                  Done ({done.length})
                </button>
                <Button variant="text" onClick={() => setClearing(true)}>
                  Clear done
                </Button>
              </div>
              {showDone ? (
                <ul class="tlist" id="done-list" aria-label="Done tasks">
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} onDelete={setDel} onCategory={setRecat} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <aside class="tasks-grid__side only-desktop" aria-label="Categories">
          <div class="card">
            <h2 class="card__title">Categories</h2>
            <Categories onDelete={askDeleteCat} />
          </div>
        </aside>
      </div>

      {manage ? (
        <Dialog title="Categories" onClose={() => setManage(false)} sheet>
          <Categories onDelete={askDeleteCat} />
        </Dialog>
      ) : null}

      {del ? (
        <Dialog
          title="Delete this task?"
          onClose={() => setDel(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setDel(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  core.store.deleteTask(del.id);
                  setDel(null);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>“{del.name}” will be removed. Focus time you already logged for it stays in your stats.</p>
        </Dialog>
      ) : null}

      {recat ? (
        <Dialog title="Change category" onClose={() => setRecat(null)} sheet>
          <div class="picker" role="radiogroup" aria-label="Category">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={categoryOf(d, recat).id === c.id}
                class="pick"
                onClick={() => {
                  core.store.updateTask(recat.id, { categoryId: c.id });
                  setRecat(null);
                }}
              >
                <span class="pick__radio" />
                <Swatch slot={c.color} />
                <span class="pick__name">{c.name}</span>
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}

      {delCat ? (
        <Dialog
          title={`Delete ${delCat.name}?`}
          onClose={() => setDelCat(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setDelCat(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  try {
                    core.store.deleteCategory(delCat.id, moveTo);
                  } catch {
                    /* the last category cannot be deleted; the button is disabled for that case */
                  }
                  setDelCat(null);
                }}
              >
                Delete category
              </Button>
            </>
          }
        >
          <Select
            label="Move its tasks to"
            value={moveTo}
            onChange={setMoveTo}
            options={cats.filter((c) => c.id !== delCat.id).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Dialog>
      ) : null}

      {clearing ? (
        <Dialog
          title="Clear done tasks?"
          onClose={() => setClearing(false)}
          footer={
            <>
              <Button variant="text" onClick={() => setClearing(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  core.store.clearDone();
                  setClearing(false);
                }}
              >
                Clear {done.length}
              </Button>
            </>
          }
        >
          <p>
            This removes {done.length} done {done.length === 1 ? 'task' : 'tasks'} from your list. Logged
            focus time stays in your stats.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
