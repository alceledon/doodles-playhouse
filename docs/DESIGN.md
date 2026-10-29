# Doodle's Playhouse: game design

An original first-person horror game for the browser (mouse and keyboard), inspired by *Granny*.
Instead of Granny, a giant golden doodle named **Doodle** hunts you through a colorful kids'
playhouse at night. Everything (models, textures, sounds) is generated in code. No outside
assets, and nothing copied from Granny.

**Tone:** Granny-level scary. Dark rooms, jumpscares and unsettling audio, but no gore. The
colorful toys in the dark are what make it cute-creepy.

**Look:** low-poly, chunky shapes with low-res pixel textures (32–64 px canvases with
`NearestFilter`), like Granny and old 3D Flash games.

## Premise
You came to a sleepover at the playhouse. Everyone else went home. Doodle didn't.

The camera sits at kid height (eye level 1.1 m), so the furniture and the dog both look huge.

## Day loop (escape in 5 days)
- **Each day starts** with you waking in the bottom bunk in the **Kids' Bedroom** (upstairs),
  after a "DAY N" title card.
- **Doodle** starts in its kennel in the basement and gets up after ~8 s.
- **Getting caught** plays the catch cutscene:
  - Whatever you were holding drops where you were caught.
  - Locks you already opened stay open, and items stay wherever you left them.
- **Getting caught on Day 5 is game over.** Doodle drags you to its kennel: "Doodle has a new
  chew toy."
- **There is no timer.**

## The map (four levels)
Floors are joined by stairs. Slides and crawl tunnels are player-only: Doodle can't follow you
into them.

- **Attic:**
  - A teddy-bear hoard: dozens of stuffed animals, some with heads that slowly turn toward you.
  - Glow-in-the-dark stars.
  - A locked toy chest that holds the squeaky-toy launcher.
- **Upstairs:**
  - Kids' Bedroom (start room, bunk beds).
  - Nursery with a spinning mobile.
  - Craft Room with crayon walls.
  - Bathroom.
  - The **Big Slide**, which goes down to the living-room ball pit.
- **Ground floor:**
  - Front Hall (the main exit).
  - Living Room, with a giant ball pit and an old TV that flicks on with static.
  - Play Kitchen.
  - Tea Party Room, with stuffed animals seated around a table.
  - Music Room, with a toy piano.
  - **Garage** (the second exit).
  - A toy train that circles one room on a track.
- **Basement:**
  - Doodle's kennel: a chewed bed and bones.
  - Laundry corner and boiler.
  - Fuse box.
  - A crawl tunnel up to the play kitchen.
- **Decor:**
  - Rainbow rugs.
  - Crayon drawings of the dog, some scratched up.
  - A "GOOD DOG" sign and chewed toys.
  - Flickering nightlights.
  - Polka-dot and star wallpaper.

## Escapes (two routes)
1. **Front door: three locks.**
   - **Padlock:** needs the **Padlock Key**.
   - **Plank** nailed across the door: needs the **Hammer**.
   - **Color keypad:** needs a 4-digit code. The code changes every run. Its digits are written
     in crayon on 4 drawings around the house, and each digit's color tells you its position.
2. **Garage.**
   - The ride-on toy **Jeep** needs the **Jeep Key** and the **Car Battery**. Carrying the
     battery slows you down.
   - The garage door opener works only after the **Fuse** is in the basement fuse box.
   - Starting the Jeep is loud, so Doodle comes running. Then you drive out through the garage
     door.

## Items: one in hand at a time
- **The one-hand rule** is Granny's core tension.
- **Dropping an item makes noise.**
- **Spawns are randomized every run** from candidate spots. Some spots are inside drawers and
  toy chests.

| Item | Use |
|---|---|
| Padlock Key | Opens the front door padlock |
| Hammer | Pulls the plank off the front door |
| Jeep Key | Goes in the Jeep |
| Car Battery | Goes in the Jeep. You walk slower while carrying it |
| Fuse | Goes in the basement fuse box; powers the garage door opener |
| Toy Chest Key | Opens the attic chest |
| Tennis Ball | Throw it. It makes noise where it lands and Doodle runs to fetch it. Doodle later drops it on its kennel bed, so you can get it back |
| Bag of Treats (3 uses) | Drop one: Doodle stops to eat it (~5 s). Dropping one in its path breaks a chase. On Hard there's a 50% chance Doodle ignores it |
| Squeaky-toy Launcher | The Granny crossbow equivalent. Starts in the locked attic chest with 2 shots. A hit stuns Doodle (30 / 20 / 12 s by difficulty) while it chews the toy |
| Squeaky Dart | Rare spare ammo for the launcher |

## Hiding, shortcuts and noise traps
- **Hiding spots:**
  - The ball pit.
  - Toy chests.
  - Blanket forts.
  - Under the bunk beds.
  - The wardrobe.
  - The play-kitchen cabinet.
- **While hidden,** the camera looks out through slats, or from under the balls.
  - If Doodle **saw you hide**, it pulls you out and you're caught.
  - Your scent builds up while you hide, so you can't stay forever.
- **The Big Slide** is a fast escape from upstairs, but the landing makes a loud splash.
- **Crawl tunnels** need you to crouch. Doodle can't follow you into them.
- **Noise traps:**
  - Squeaky toys on the floor. Positions are randomized, and Hard has more of them.
  - Creaky floorboards (visible lighter planks).
  - The toy piano, if you bump it.
  - Block towers that topple.
  - Doors creaking.
  - Sprinting footsteps.
- **Walking while crouched is silent.**

## Doodle
- **Look:**
  - An oversized, fluffy golden body built from low-poly blobs, with a curly-fur pixel texture.
  - Floppy ears, a tongue, and a collar with a tag that reads "DOODLE".
  - Animated in code: leg swing, tail wag, ear flop, head bob.
  - **Eyeshine** glows in the dark, so in a dark hallway you see the two eyes first.
  - While chasing, its ears pin back, its eyes turn red and its mouth opens.
- **Brain states:**
  - SLEEP: start of each day.
  - PATROL.
  - INVESTIGATE: heard a noise.
  - SNIFF: following your scent.
  - CHASE: can see you.
  - SEARCH: lost you.
  - DISTRACTED: fetching the ball or eating a treat.
  - STUNNED: chewing a dart.
  - CATCH.
- **Hearing:** noises have a loudness radius, reduced through floors and scaled by difficulty.
- **Sight:** a 110° view cone with line of sight. Its range is longer when your flashlight is on
  and shorter when you're crouched in the dark.
- **Smell:**
  - You leave timestamped scent crumbs about every 1 m, and Doodle follows them toward the
    freshest one.
  - Standing still or hiding builds up a scent pool that draws it in.
- **Movement:**
  - It opens doors (you hear the creak) and uses stairs.
  - It never uses tunnels or slides.
  - It does a short lunge when it's close.
- **Speeds (Normal):**
  - Doodle: patrol 2.5 m/s, chase 4.6 m/s.
  - You: walk 3, sprint 5 (limited by a stamina bar), crouch 1.5. So sprinting outruns Doodle
    until your stamina runs out.

## Difficulty
| | Practice | Easy | Normal | Hard |
|---|---|---|---|---|
| Doodle | none | slower, smaller hearing | baseline | faster, keener, stronger nose |
| Noise traps | few | few | normal | many |
| Treats / spare darts | n/a | more | normal | fewer |
| Stun time | n/a | 30 s | 20 s | 12 s |

Each area keeps its own numbers in `src/<area>/tuning.js` as a `tuningFor(difficulty)`
function.

## Horror layer
- **Sound:** all procedural Web Audio with HRTF positional panning.
  - Doodle's **collar jingle** grows louder as it approaches. It's your main warning.
  - Panting.
  - A growl when it spots you, plus a chase stinger.
  - Distant barks.
  - A **heartbeat** when Doodle is near.
  - A detuning **music-box lullaby** over a low drone.
  - Squeaks, creaks, footsteps, TV static.
- **Catch cutscene:**
  1. The camera is knocked to the floor.
  2. Doodle pounces into frame, and its face fills the screen with its mouth open and a loud
     bark sting.
  3. It licks you, the screen fades to black, and the "DAY N+1" card appears.
- **Win:** you run out into the night (or drive the Jeep out). A results screen shows days used,
  time, and your best time for that difficulty.

## Controls
| Input | Action |
|---|---|
| Mouse | Look (pointer lock) |
| WASD | Move |
| Shift | Sprint (stamina) |
| C | Crouch / crawl. Not Ctrl, because Ctrl+W closes the tab |
| Left click / E | Interact: pick up, open, hide, use a lock, enter a slide or tunnel |
| Right click | Use held item: throw, drop a treat, fire |
| G | Drop held item |
| F | Flashlight |
| Esc | Pause |

On phones and tablets (Granny's mobile scheme; see `src/gameplay/README.md`):
- **Left half:** a stick appears where your thumb lands. Push it to the rim to sprint.
- **Right half:** drag to look. A quick tap uses whatever is under your finger.
- **Buttons:** a hand (interact with what's in the middle, lit when there's something), Use,
  Drop, Crouch, Flashlight, and Pause in the top corner.
- **Phones** play in landscape; held upright they show "Rotate your phone" and pause.
- **Settings** adds a touch look sensitivity.

## HUD and menus
- **HUD (Granny-minimal):**
  - A center dot that becomes a hand when you look at something you can use.
  - A prompt line, e.g. "Click: pick up Padlock Key".
  - The held-item icon.
  - The stamina bar.
  - The day card.
- **Menus:**
  - Title screen in a crayon font, with difficulty select.
  - How to Play.
  - Settings: mouse sensitivity, invert Y, volume, render quality. Saved in `localStorage`.
  - Best times per difficulty.
  - An online leaderboard shared by everyone, one board per difficulty, ranked by fastest
    time (days used and the way out are shown but don't count). The title screen shows each
    board's top 10. After an escape of a minute or more you can post your time under a name
    of up to 6 letters or numbers; dev and test runs can't post.

## Rendering budget
- **Materials and fog:** Lambert materials and fog. No shadows.
- **Lights:** a fixed pool of ~6 point lights, moved to the nearest lamps every ~0.5 s. That
  gives lots of lamps without shader recompiles.
- **Instancing:** use `InstancedMesh` for ball-pit balls and stuffed animals.
- **Target:** 60 fps on an integrated GPU at the default "medium" quality (0.75× render scale).

## Debug (`?debug=1`)
- FPS, game phase, the player's and Doodle's state.
- The `window.__game` handle.
- Each area adds its own debug hooks behind this flag:
  - No-clip.
  - Give-item keys.
  - Doodle path, noise and scent overlays.
