**2026.41.6**

**Permini**
* Added advanced settings to every user item.
* You can now choose which days a rule is active and set a specific time range.
* For example, you can make a rule active on Monday and Friday between 07:00 and 12:00.

**Status Schedule**
* Added **Instance Condition**. Change your status based on the instance you are currently in.
* Added **Friend Condition**. Change your status when a specific friend is present in your instance.
* Added **Player Count Condition**. Change your status based on the current player count from 0 to 80.

**Saving / Storage**
* Migrated the photo store from JSON to SQLite.
* Migrated the new rating system to SQLite and merged it with the photo store.
* The database now stores photo metadata such as players, file size, tags, rating, favorite state, and players present in the instance.
* Background scans will still run, but cached SQLite data is shown first for a much faster response.

**VR Overlay**
* Added **SteamVR Input** support for Valve Index controllers.
* Added a new dropdown next to the controller view switch with **Legacy (Default)** and **SteamVR (Index)** modes.
* Keybinds are stored separately for each mode. Switching back to Legacy restores your previous binds without overwriting anything.
* Added a Valve Index controller image. Keybinds can now be selected directly from the controller in both modes.
* Clicking an area on the controller opens its available inputs. Green represents button presses, while blue represents touch or force inputs.

**Media Library**
* Added photo ratings using Windows file properties. You can assign a rating when opening a photo.
* Added a **Rating** filter to show images based on their assigned rating.
* Added an image count badge to the sidebar.

Rated images and favorited images are separate. Rating an image does not automatically favorite it.

**Context Menu**
* Added a **Rating** submenu to the Media Library context menu for quickly rating images.
* Moved **Upload**, **Set As**, **Banner**, and **Profile Icon** into a submenu inside the Media Library to free up space.
* Use Safety triangle for sub dropdowns to prevent missclicks.

**Improvements**
* Profiles now show both the **Age Verified** and **18+** badges when applicable.
* Your own status now shows a circle when VRChat is currently not running.

**Fixed Bugs**
* Fixed the **18+** badge being shown on profiles that were only age verified. Being age verified does not automatically mean the user is 18+.
* Fixed TTS test playback and notifications sometimes silently stopping after a network issue with the Edge voice engine and requiring an app restart.
* Updated the friend picker to use the V2 design.
* Fixed an issue causing the Media Library to use a large amount of system resources during initial loading.
* Fixed context menu submenus flickering or failing to open while hovering over them.
* Fixed taskbar and modal dropdown submenus flickering or failing to open while hovering over them.

---

**CVRC fork additions on top of the above**
* VRChat Accounts tool — launch up to 10 independent, concurrently logged-in VRChat instances via `--profile=N`
* Avatar Database tool — browse/sort downloadable avatars from the community Gofile database
* Avatar Logger tool — watches your VRChat log for avatars you and others switch into, tracks size/visibility/thumbnails, and can auto-upload delivered avatar files to GoFile with a local archive-folder backup
* OSC avatar emotes and live avatar height/scale controls
* Background music with a custom track picker
* Chatbox "Now Playing" media-source pinning and native typing indicator
