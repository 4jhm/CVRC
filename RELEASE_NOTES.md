**2026.42.1**
* HOTFIX - Pin system shows only world id instead of world name.
* HOTFIX - Pin system shows username weirdly.
* HOTFIX - Pin system shows incorrect names, images and icons.

**2026.42.0**
**Smart Search**
* Added **Friends** and **Personal Timeline** buttons to Smart Search, allowing you to quickly search the timeline for a keyword without opening the Timeline first.

**Profile Previews**
* Updated the profile preview design to v2.
* Fixed time spent and meet counts showing different values than the profile and the Time Spent tab.

**Notifications**
* Notifications have now a volume slider so you can choose how loud the notification is.
* Added new notification dropdowns with 15 sounds to all four notification types.

**User Profiles**
* Added a **Creator** badge for users who sell content or participate in the VRChat Creator Economy.
* Added a **Trusted Score** showing how established and trustworthy a user appears to be.
* The score considers account age, uploaded worlds or avatars, VRC+ support, biography, trust rank, badges, and Creator Economy participation.
* Added a trust description inside **Trust & Safety** based on the user's score.

**Action Flow**
* Added "left player name (string)" action flows.
* Fixed an bug where the joined playername returned an user id instead of username.

**Time Spent**
* Updated the Time Spent tab design to v2.

**Dashboard**
* Completely redesigned the Dashboard with the new **VRCN v2** style.
* Added customizable hero widgets for **Friends/Group Activity**, **Next Event**, and **VRChat News**.
* Added a new **Pins** hero widget.
* Reworked **Edit Dashboard**. Widgets can now be added, removed, and reordered directly on the Dashboard.
* Added support for **2 widgets side by side**.
* Redesigned and improved most Dashboard widgets.
* Removed several outdated or redundant widgets.

**VR Overlay**
* Fixed major FPS drops caused by images being resized every frame. Images are now scaled once and reused, keeping the overlay smooth regardless of source resolution.
* This applies across the entire overlay, including world thumbnails, friend avatars, notifications, the Friends tab, your avatar, music album art and its blurred background, and notification toasts.
* Further improved overlay rendering by reducing unnecessary CPU work.

**Groups**
* Added a new **Group Instances** tab showing active instances from all your groups.

**Timeline**
* The search bar now suggests friends and worlds while typing. Selecting one creates a badge that filters the timeline to that friend or world.

**Performance**
* Improved memory cleanup to reduce VRCNext's RAM usage.
* **Memory Trim** is now enabled by default and runs every 15 minutes.
* The VR helper now only runs when needed, saving around **100 MB of RAM** when VR features are not being used.
* Improved loading performance in the **Time Spent** tab by around **150%**.

**Modals**
* Profile, World, Group, and Avatar modals now always use the **Compact** layout.
* Modal actions and breadcrumb history now always appear in the top bar.
* Removed the old taskbar navigation mode and its related settings.
* Added outlines to cards.

**Removed**
* Removed the **Navigation** tab from Settings.
* Removed the **Classic** modal design for Profile, World, Group, and Avatar modals.
* Removed the **Direct Modal Search** option, as it is now always enabled.

**Fixes**
* Fixed the horizontal scroll position in **People > Instance** resetting during player list updates.
* Fixed **See All** on the **Friends Recent Activity** widget not opening **Timeline > Friends**.
* **See All** on the **Group Activity** widget now opens **Groups > Group Instances**.
* Fixed Dashboard timeline events not updating live and requiring a manual refresh.
* Fixed activity widgets showing internal names such as `group.announcement` instead of proper labels. Status changes now also show the old and new status again.
* Fixed missing right-click context menus on **Friends Activity** and **Group Activity** hero widgets.
* Fixed the World modal header image disappearing or becoming corrupted after opening a timeline event from inside the modal.
* Fixed Dashboard timeline events not using localization keys.
* Fixed timeline events not showing status dots.
* Fixed avatar author lookups always sending at least one unnecessary request to AVTRDB. Pagination now follows the API's `has_more` flag, cutting requests in half for authors with only one page of avatars.
* Fixed the **AVTRDB/GET** Activity Log counter always staying at 0 even while avatar searches were running.
* Added missing `instance.announcement` support to the notification system and Timeline.
* Fixed audio devices changing after restarting VRCNext, Windows, or reconnecting devices.
* Audio devices are now saved using their stable Windows device ID so the correct device is restored reliably.
* Missing devices now show as **(Unavailable)** without overwriting the saved selection or using another device.
* Existing audio settings are migrated automatically where possible.
* Fixed FrameShot audio inputs losing their selection while temporarily unavailable.
* Fixed inaccuracies in the **Time Spent** tab that could show incorrect overall playtime.
* Fixed inaccurate person counts, meet counts, and time-spent values in the **Time Spent** tab.
* Fixed an issue on time spent tab causing the users and worlds to not be filtered correctly.
* Fixed an issue where time spent tab showed wrong orders or spent-bars.
* Fixed meet counts being one too low in **Rewind** and inconsistent in **Profile Insights**.

**Internal Changes**
Mostly cleanup to improve maintainability and reduce some of the structural chaos created over time.
* Removed unused methods left over, JavaScript functions, old CSS classes left over from the V1 design.
* Removed **VRChat.API**, as VRCNext no longer uses it.
* Updated **NAudio** from 2.2.1 to 3.0.0.

**2026.41.12**

**Improvements**

* Fixed false **Went Offline** and **Came Online** entries when friends were only switching between instances. VRChat may briefly report friends as offline during a world switch.
* Offline reports for in-game friends are now delayed by 1 minute. If the friend comes back online within that time, nothing is logged. The Timeline entry and VR Overlay notification are only created if they remain offline.
* While a friend is in this waiting state, the Sidebar and People tab now show **Pending offline...** with a grey status dot.
* Friends switching worlds now show **Traveling...** in the Sidebar and People tab until they arrive in the new instance.
* Timeline world visits now end at the time the friend actually left instead of 1 minute later.

**2026.41.11**

**Timeline**
* The **Detail** column in list view now starts with a time spent badge, for example **3h 17m · USE · Friends+ · Japan Rainy Day**.
* Instances that are still running show **Ongoing** instead. Entries without tracked time show no badge at all.
* Applies to **Personal > Instances** and **Friends > Location**.

**UI Changes**
* Updated the **VRChat Config** modal.
* Updated the **VRChat Launch Options** modal.
* Updated the **Edit Dashboard** modal.
* Updated the **Edit Navbar** modal.
* Updated the **Change Status** modal.
* Updated sidebar colors, inputs, and refresh buttons.
* Media Library cards now show file size, resolution, and rating in a single line separated by dots, for example **4.2 MB · HD · ♥ 3x**. The rating is only shown when one is set.
* Removed the SD/HD/2K/4K/8K badges from Media Library cards.

**Performance**
* Added **Settings > General > VRC+ Decorations > Optimize VRC+ Usage**. This is enabled by default. Animated VRC+ decorations, such as icon frames and nameplates, are shown as static images in friend lists and cards. Animations still play in profile modals and on your own profile in the sidebar. A single animated decoration can use over 200 MB of RAM while playing, so this greatly reduces memory and GPU usage for users with decorations enabled. Disable the setting to keep animations enabled everywhere.
* Friend cards in the sidebar are now completely skipped by the renderer while they are outside the visible area.

**Changes**
* **List View** is now the default in Timeline. Timeline View is still available as the secondary option.
* **Use Direct Modal Navigation** is now enabled by default on clean installs.
* Moved the clock from the left sidebar to the taskbar.
* Moved the **Other** card from Appearance to **Sidebar** and renamed it to **Taskbar**.
* Small adjustments in "Activity Log" tab for better responsive design.

**Removed**
* Removed **Additional Options** from Appearance.
* Removed the clock from the sidebar.
* Removed the **AM/PM** toggle. The time format now follows your system settings.
* Removed the **Use Trusted Rank Color instead of Badge** setting. Trusted users will now always use the Trusted rank color for their username. This reduces unnecessary settings and makes the UI easier to maintain.

**2026.41.10**

**UI Recator**
* Added Card design to major tabs.
* Changed some colors and ui schemes.

**Taskbar**
* Added "Edit Taskbar" and "Edit Dashboard" to the "View" section.

**Timeline**
* Instance entries under **Personal > Instances** now show the server region and instance type as badges.
* Location entries under **Friends > Location** now show the same badges.
* Both detail modals now show a **Server** row with the region the instance ran on.
* Changed the status badges to status dots for a cleaning Ui.
* Changed color of "Meet Again" and "Bio Change" types.

**Improvements**
* Improved Light Mode on the Dashboard.
* Sidebar folders now use a larger 5x3 layout instead of 3x3.
* Updated the **X** close button on several modals to the new VRCN v2 design.

**Calendar**
* Updated Calendar to the VRCN v2 design.
* Calendar now shows up to 2 events per day, with **"X more events"** for additional events.
* Added a new **Week View** for a better overview of upcoming events.
* Calendar now uses the same date picker as Timeline.
* Added **Help Sort**, which gives each group a fixed color to make events easier to tell apart.
* Fixed Calendar cells not resizing correctly with the window.

**Performance**
* Fixed several memory leaks that could increase RAM usage during long sessions.
* Improved memory cleanup for VR Overlay notifications, visited worlds, player profiles, Voice Fight, and Kikitan XD.
* Improved performance for users with very large friend lists.
* Friend updates now only refresh the parts of the UI that actually changed instead of rebuilding the entire Friends Sidebar and Dashboard.
* Status, location, and avatar changes now only update that specific friend's card.
* Reduced CPU and memory usage when updating large friend lists.
* VRCNext now regularly cleans up unused memory during long sessions.
* Added **Settings > Performance > Image Cache > Optimize Memory Usage**, enabled by default.
* Smaller avatars and icons now use lightweight thumbnails, while larger cards use 256px images instead of 800px. This can greatly reduce RAM and GPU memory usage.
* Full-quality images are still shown when opening or inspecting them.
* Image memory settings apply immediately without restarting VRCNext.

**Changes**
* The Notification Modal now uses the new refresh button design.
* Changed the colors ofr instance types.
* Changed the status colors slightly to be more saturated.
* Updated People tab to new edit mode. should have the same behavior as world tab now.
* Updated Avatars tab to new edit mode. should have the same behavior as world tab now.

**2026.41.8**

**VR Overlay**

- Shows now Action Flow notifications on the wrist overlay.
- Shows now Action Flow notifications on the floaty notify crumbs.

**Action Flow**

- Changed action block limit from 10 to 20 action blocks per flow max. Please keep in mind the server request limit remains 20 per 10 minutes window to prevent any VRChat API spam.
- #145 Instance info webhooks now carry the full instance instead of only the world. The embed title and a new **Join Instance** link both lead straight into the instance.
- Messages now include the instance name, region, group name and player count. Player count is new for friend instance info, it was previously only sent for your own instance.
- Applies to all three blocks: own instance info, own advanced instance info and friend instance info.
- Notifications now use the flow name as their title instead of a generic "Action Flow", in VR as well as in the desktop notification.

*New blocks*

- New **Get Info** category. Every block returns text you can plug into a notification: current world name, avatar name, instance name, instance ID, player count, player list, friends in game, current time and the name of the player that triggered the flow.
- Get Info costs nothing. Every block reads data VRCNext already holds, so it never adds a single VRChat API request.
- **Actions > switch to avatar** takes an avatar ID directly, so you no longer have to pick from your own or favorite avatars.
- **Actions > set current world as home world** sets the world you are in as your home world.
- **Actions > send notification** now also accepts a Get Info block, and **send advanced notification** combines your own text with one, for example `Joined: <joined player name>`.
- **Game > close VRChat** closes the game, useful for shutting down after a while. It uses no VRChat API call and does not count towards the request limit.

**Deep Links**

- Added `vrcn://instance/<location>` which opens the instance details inside VRCNext.
- Added `vrcn://instance-join/<location>` which opens the launch dialog. It launches VRChat into the instance while the game is closed and offers a self invite once it is running.

**Fixed Bugs**

- Fixed the platform filter having no effect under Avatars > Recently Used.
- Fixed platform icons missing on cards under Avatars > Recently Used. Both were caused by cached avatars not carrying their platform data.
- Fixed **Create & Join** only sending a self invite while VRChat was closed. It now launches VRChat straight into the new instance.
- Fixed #150 Action Flow reporting an empty instance when a flow ran shortly after a world switch. It now waits until the player list has settled.
- Fixed avatar search falsely reporting every avatar as deleted while signed out of VRChat. No availability checks run without an active session.

**Security**
*Linux Only*

- Fixed #146 where VRChat credentials on Linux were not properly encrypted and could be easily decoded from `settings.json`.
- Linux now securely encrypts your VRChat password, auth cookie, and 2FA cookie using AES-256-GCM.
- Encryption keys are stored separately and protected so copied settings cannot simply be used on another machine.
- Existing logins continue to work and old credentials are automatically upgraded to the new encryption.
- Windows continues to use DPAPI for secure credential storage.

**2026.41.7**

**Activity Log**
* Updated the activity log to the new v2 design.
* Added more information about how many requests are made to avtrdb.
This includes searches and avatar lookups.

---

**CVRC fork additions on top of the above**
* Now identifies itself to the VRChat API with its own User-Agent (`CVRC/<version> (4jhmweb@gmail.com)`) instead of the original VRCNext developer's, per their request that forks use their own identity/contact info
* VRChat Accounts tool — launch up to 10 independent, concurrently logged-in VRChat instances via `--profile=N`
* Avatar Database tool — browse/sort downloadable avatars from the community Gofile database
* Avatar Logger tool — watches your VRChat log for avatars you and others switch into, tracks size/visibility/thumbnails, and can auto-upload delivered avatar files to GoFile with a local archive-folder backup. Each entry now shows the exact date/time it was obtained, plus one-click "Upload to Files" (saves straight to your Local Archive Folder) and a "File" button that opens the exact cache folder in Explorer
* **Abyss Support** — Avatar Logger no longer assumes a stock VRChat install. A custom **VRChat Cache Folder** setting lets you point it at a relocated cache directory, and a custom **Cache File Extension** filter (or auto-detect by default) finds the cached avatar bundle even on setups where it isn't named the usual `__data`. Also fixed GoFile uploads silently failing/showing "No files found" after repeated app restarts — the guest account token is now persisted to disk and reused instead of minting a new throwaway account (and tripping Gofile's rate limit) on every launch
* Emoji Maker tool — converts a GIF/MP4/MOV/WebM clip into a VRChat animated emoji sprite sheet entirely client-side
* OSC Radial Menu tool — paged radial control for avatar emotes and OSC parameters, on desktop and as a new Expressions tab in the VR wrist overlay
* OSC avatar emotes and live avatar height/scale controls
* Export / Import Settings (Settings → Data) — saves everything in the app (accounts, Avatar Logger config, all other settings) to a file you choose anywhere, and imports it back after a reset
* Background Music now has a volume slider, and custom tracks are sent to the player directly instead of over a local HTTP fetch that could silently fail — picking your own track now reliably takes effect
* Removed the Avtrdb/Avtr.icu "Community Support" report/submit toggles from Settings (searching avatars via those services in the Avatars tab is unaffected) — CVRC's own VRCNDb submission is untouched
* Linux install script renamed `install_vrcnext.sh` → `install_cvrc.sh` and rebranded throughout; also fixed the Linux AppImage build script, which had been looking for a `VRCNext` binary that hasn't existed since the executable was renamed to `CVRC`
* Background music with a custom track picker
* Chatbox "Now Playing" media-source pinning and native typing indicator
* People → Instance tab now shows a live **Avatar** column — the name and creator of the avatar each nearby player is wearing, filled in the moment VRChat finishes loading it. Once resolved you can **Wear** it yourself (VRChat's own avatar-select API, same as pedestal avatars) or **Favorite** it, straight from the row
* Action Flow: raised the per-flow action-block limit from 20 to 40
* Action Flow: added a **Backpack** — right-click any block and choose "Add to Backpack" to save it (with everything snapped below/inside it) for reuse in any flow. Click a saved item in the new Backpack panel to drop it into the flow you're currently editing
