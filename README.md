# Orbit Crew — train together, get stronger together

Orbit Crew is a social fitness app for people who want the accountability and community of Strava, built around gym sessions instead of runs.
<p float="left">
  <img width="1710" height="948" alt="Screenshot 2026-09-20 at 4 44 37 PM" src="https://github.com/user-attachments/assets/79d231ca-63f3-40f2-a51f-9eefd935dfd1" />
  <img width="1710" height="948" alt="Screenshot 2026-09-20 at 4 47 06 PM" src="https://github.com/user-attachments/assets/64b351db-570a-4114-9399-98de960bdb12" />

</p>

## Run the app locally

Prerequisites: Node.js, npm, and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) for the local backend. For mobile development, also install Expo Go on a device or have an iOS Simulator / Android emulator available.

```bash
npm install
cp .env.example .env
npm run db:start
npm start
```

`npm run db:start` prints the local API URL and anon key. Copy those values into `.env` if they differ from the example defaults. When testing on a physical phone, set `EXPO_PUBLIC_SUPABASE_URL` to your computer's LAN IP instead of `127.0.0.1` so the device can reach Supabase.

Once Expo starts, scan its QR code with Expo Go, or press `i` for iOS, `a` for Android, or `w` for the web app. You can also start a platform directly with `npm run ios`, `npm run android`, or `npm run web`.

## Inspiration

Going to the gym is easier when your friends are doing it too. Orbit Crew was created to make fitness more social, motivating, and consistent: track your own progress, see when friends are training, work toward shared crew goals, and celebrate improvements together.

Instead of competing only on weight lifted or time spent in the gym, Orbit Crew rewards showing up, building consistency, and helping your crew reach its goals.

## What it does

- Track gym sessions, workout duration, exercises, sets, reps, and weight
- Monitor personal records, estimated one-rep maxes, training volume, and consistency over time
- Create private friend groups called crews
- Set shared weekly crew goals, such as 36 combined gym sessions
- View crew progress bars, live activity, weekly leaderboards, and motivation spotlights
- Join challenges like Early Bird, Consistency, Exploration, and crew-wide session goals
- Find nearby verified gyms and view gym ratings, equipment quality, crowding, cleanliness, and AC
- See friends who have opted in to share that they are currently training at a gym
- Explore an interactive map with gym markers, friend-presence indicators, and University of Waterloo campus 3D buildings on web
- Protect privacy by sharing gym-level check-ins rather than precise live GPS locations

## How we built it

- React Native
- Expo
- Expo Router
- TypeScript
- Supabase Auth
- Supabase PostgreSQL and Row Level Security
- Supabase Realtime for crew activity and gym presence
- MapLibre GL for the web map
- OpenStreetMap building and location data
- University of Waterloo campus building geometry
- Responsive web and mobile layouts

## The Orbit Crew experience

Orbit Crew starts with one simple action: check in and train.

Each completed session contributes to your personal progress and, if you choose, your private crew’s weekly goal. Your crew can see the shared momentum build in real time, join challenges together, compare weekly consistency, and encourage one another to keep going.

Whether you are trying to hit a new bench press PR, train three times a week, find a gym your friends already use, or help your crew reach 50 sessions, Orbit Crew turns individual workouts into a shared habit.
