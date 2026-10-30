// The Realtime Database behind online co-op (see README.md, "Co-op"). An empty
// databaseURL means co-op isn't set up, and the title screen doesn't offer it
// (except with ?net=local, which needs no server).
//
// The URL is public by design: database.rules.json decides what anyone may read
// or write, not keeping this secret.
export const NET = {
  databaseURL: 'https://doodles-playhouse-default-rtdb.firebaseio.com',
};
