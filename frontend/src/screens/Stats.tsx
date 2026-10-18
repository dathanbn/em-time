import { useEffect, useState } from 'preact/hooks';
import { MIN, TREND_RANGES, formatDayLabel, formatDuration, formatRange, type TrendRange } from '@core';
import { ExportReminder } from '../app/Banners';
import { clockTick, core, data } from '../app/coreBridge';
import { friends, friendsUi, loadFriendsUi, watchFriends } from '../app/friends';
import { plural } from '../app/selectors';
import { GoalRing } from '../charts/GoalRing';
import { Heatmap, heatSummary } from '../charts/Heatmap';
import { StatTile } from '../charts/StatTile';
import { TableToggle } from '../charts/ChartTable';
import { TaskBars } from '../charts/TaskBars';
import { TrendChart } from '../charts/TrendChart';
import { WeekColumns } from '../charts/WeekColumns';
import { Companion } from '../components/Companion';
import { Button, IconButton, Segmented } from '../components/ui';
import { useNarrow } from '../app/useNarrow';

const dayWord = (n: number) => plural(n, 'day');

export function Stats() {
  const d = data.value;
  void clockTick.value;
  const narrow = useNarrow();
  const [offset, setOffset] = useState(0);
  const [range, setRange] = useState<TrendRange>(30);
  const [weekTable, setWeekTable] = useState(false);
  const [heatTable, setHeatTable] = useState(false);
  const [trendTable, setTrendTable] = useState(false);
  const fstate = friends.value;
  const showFriends = fstate.status !== 'off';
  const FriendsBody = friendsUi.value?.FriendsTileBody;

  // Friends: ask on arrival and whenever the tab comes back to the front (the call itself is throttled).
  useEffect(() => {
    if (!showFriends) return;
    void loadFriendsUi();
    return watchFriends(); // now, and whenever the tab comes back (at most once a minute)
  }, [showFriends]);

  const today = core.select.today();
  const streak = core.select.streak();
  const week = core.select.week(offset);
  const cells = core.select.heatmap();
  const trend = core.select.trend(range);
  const weekPts = showFriends ? core.select.trend(30).slice(-7) : [];
  const weekDays = weekPts.map((p) => p.day);
  const hs = heatSummary(cells);
  const hasSessions = d.sessions.some((s) => s.deletedAt === null);
  const goalMin = d.settings.dailyGoalMin;

  return (
    <div class="page page--stats">
      <div class="pagehead">
        <h1 class="pagehead__title">Stats</h1>
        <div class="pagehead__end">
          <Companion size={narrow ? 48 : 56} idleOnly />
        </div>
      </div>
      <ExportReminder />

      <div class={`tiles${showFriends ? ' tiles--friends' : ''}`}>
        <StatTile label="Today" testid="today-tile">
          <div class="tile__ring">
            <GoalRing summary={today} size={120} />
            <p class="tile__ringtext">{plural(today.sessions, 'session')} today</p>
          </div>
        </StatTile>
        {showFriends ? (
          <StatTile label="Friends" testid="friends-tile">
            {FriendsBody ? (
              <FriendsBody
                state={fstate}
                days={weekDays}
                you={weekDays.map((day) => weekPts.find((p) => p.day === day)?.valueMin ?? 0)}
                narrow={narrow}
                now={Date.now()}
              />
            ) : (
              <div class="fchart-hold" aria-hidden="true" />
            )}
          </StatTile>
        ) : null}
        <StatTile
          label="Current streak"
          value={dayWord(streak.current)}
          note={!streak.todayCounts && streak.current > 0 ? "Today's not counted yet" : null}
          testid="streak-current"
        />
        <StatTile label="Best streak" value={dayWord(streak.best)} testid="streak-best" />
      </div>

      <section class="section" aria-labelledby="h-week">
        <div class="section__head">
          <h2 id="h-week" class="section__title sectionlabel">
            This week
          </h2>
          <div class="weeknav">
            {offset !== 0 ? (
              <Button variant="secondary" onClick={() => setOffset(0)}>
                This week
              </Button>
            ) : null}
            <IconButton
              icon="chevron-left"
              size={48}
              class="iconbtn--ghost"
              label="Previous week"
              data-testid="week-prev"
              disabled={!week.hasPrev}
              onClick={() => setOffset(offset - 1)}
            />
            <IconButton
              icon="chevron-right"
              size={48}
              class="iconbtn--ghost"
              label="Next week"
              data-testid="week-next"
              disabled={!week.hasNext}
              onClick={() => setOffset(offset + 1)}
            />
          </div>
        </div>
        <div class="card card--solid">
          <p class="section__sub">{formatRange(week.start, week.end)}</p>
          <div class="weekgrid">
            <div class="weekgrid__cols">
              <div class="bigstat" data-testid="week-total">
                <span class="bigstat__value">{formatDuration(week.totalMs)}</span>
                <span class="bigstat__label">focused, {plural(week.sessions, 'session')}</span>
              </div>
              <WeekColumns week={week} narrow={narrow} table={weekTable} />
            </div>
            <div class="weekgrid__tasks">
              <h3 class="subhead">By task</h3>
              <TaskBars
                week={week}
                categories={d.categories.filter((c) => c.deletedAt === null)}
                table={weekTable}
              />
            </div>
          </div>
          <TableToggle on={weekTable} onToggle={() => setWeekTable(!weekTable)} />
        </div>
      </section>

      <section class="section" aria-labelledby="h-heat">
        <div class="section__head">
          <h2 id="h-heat" class="section__title sectionlabel">
            Last 2 months
          </h2>
        </div>
        <div class="heatgrid">
          <div class="card card--solid">
            <p class="section__sub">Daily focus time against your goal of {formatDuration(goalMin * MIN)}</p>
            <Heatmap
              cells={cells}
              weekStartsOn={d.settings.weekStartsOn}
              empty={!hasSessions}
              table={heatTable}
            />
            <TableToggle on={heatTable} onToggle={() => setHeatTable(!heatTable)} />
          </div>
          <div class="card card--solid summary">
            <dl class="summary__list">
              <div class="summary__row">
                <dt>Active days</dt>
                <dd>{hs.active}</dd>
              </div>
              <div class="summary__row">
                <dt>Total time</dt>
                <dd>{formatDuration(hs.totalMs)}</dd>
              </div>
              <div class="summary__row">
                <dt>Best day</dt>
                <dd>
                  {hs.best ? (
                    <>
                      {formatDuration(hs.best.focusMs)}
                      <span class="summary__note">{formatDayLabel(hs.best.day)}</span>
                    </>
                  ) : (
                    <span class="summary__note">None yet</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="h-trend">
        <div class="section__head">
          <h2 id="h-trend" class="section__title sectionlabel">
            Trend
          </h2>
          <Segmented
            label="Trend range"
            value={range}
            onChange={setRange}
            options={TREND_RANGES.map((r) => ({
              value: r as TrendRange,
              label: `${r} days`,
              testid: `trend-range-${r}`,
            }))}
          />
        </div>
        <div class="card card--solid">
          <p class="section__sub">Daily focus, 7-day average</p>
          <TrendChart
            points={trend}
            range={range}
            goalMin={goalMin}
            weekStartsOn={d.settings.weekStartsOn}
            narrow={narrow}
            table={trendTable}
          />
          <TableToggle on={trendTable} onToggle={() => setTrendTable(!trendTable)} />
        </div>
      </section>
    </div>
  );
}
