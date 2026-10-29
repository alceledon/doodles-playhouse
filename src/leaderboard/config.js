// The Firebase project behind the online leaderboard (see README.md, "Leaderboard"). An
// empty projectId means the board isn't set up, and the game shows nothing of it.
//
// The web API key is public by design: it only names the project to Google. What anyone
// may read or write is decided by firestore.rules, not by keeping this key secret.
export const FIREBASE = {
  projectId: 'doodles-playhouse',
  apiKey: 'AIzaSyAEpGVPhwnweM3FMXu6d_Wnrt75-gG_bSI',
};
