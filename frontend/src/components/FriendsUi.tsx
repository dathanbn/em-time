// The friends chunk: everything friends-related that is not needed to boot (the Stats tile body, the
// Settings card, and the code that talks to the server). Loaded by app/friends.ts on demand.
export { FriendsCard } from './FriendsPanel';
export { FriendsTileBody } from '../charts/FriendsChart';
export { refresh, friendsApi } from '../app/friendsRun';
