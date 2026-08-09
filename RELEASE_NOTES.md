**2026.41.2**

**HOTFIX**
* Fixed an bug in avatar tab causing flickering between list and grid view.
* Fixed an bug in world tab causing flickering between list and grid view.
* Fixed an bug in group tab causing flickering between list and grid view.
* Fixed an bug in people tab causing flickering between list and grid view.
* Fixed an bug where TTS settings are not saved/loaded properly in VR Overlay.

**Live Instance List**
* This is already a thing when you look at the friends sidebar or click the world modal it shows all player slive. However alot of you did use VRCX before so theres a new tab in People > Instance which shows all players with additional filters live.
* Added Bio links to the existing modal.
* Enhanced instance view shows: timer, joined, display name, presence, rank, status, 18+, platform, pronouns, meets, time spent, date joined, last seen, language and more.
* Allowing sorting for cells in list modal.

**VRChat Config**
* Added "Save" Prints players.
* Added **Custom Cache Folder Location** with a folder picker.
* Added **Custom Picture Folder Location** with a folder picker.
* Added **Camera Resolution**, **Spout Resolution** and **Screenshot Resolution** presets from 720p up to 4K, and 8K for the camera.
* Added **Sort pictures into folders by date** toggle.
* Added **Disable Discord Rich Presence** toggle.
* Settings that match VRChat's own default are no longer written to the config file, so the file stays clean.

**Wiki**
* Added "Wiki" button to Taskbar > Help > Wiki

**People Tab**
* Added grid and list views to **Favorites** and **All Friends**.
* The list view now shows more information, including Profile, Username, Trust Rank, Status, Language, Bio Links, Meets, Date Joined, Last Login, and more.
* Added sorting and filtering options when using list view.
* Added **Time Spent** and **Pronouns** columns to the list view.

**Worlds Tab**
* Added a list view to **Favorites** and **My Worlds**, showing World, Name, Visits, Time Spent, and Last Visited.

**Groups Tab**
* Added a list view to **Joined**, **My Groups**, and **Moderated Groups**, showing Group, Name, Short Name, and Member Count.

**Avatars Tab**
* Added a list view to **My Avatars** and **Favorites**, showing Avatar, Name, Creator, Status, and PC, Android, and iOS performance ranks.
* Added "Fetch" button that fetches all friends information with a cooldown of 1 hour. This fetches all data from friends and also updates the mutual network structure.

**Improvements**
* Avatar, World, People, Groups, Inventory, Media Library, and several other tabs now have a fixed navigation card that no longer scrolls with the content, making navigation easier at the cost of a small amount of screen space.
* When clicking an avatar it wont immedically use that avatar anymore. instead an modal opens that ask you if you really want to use this avatar or if you want to open the avatar informations modal.
* Recently visited world limit set to 100. for more check timeline.
* Recently used avatars limit set to 100. for more check timeline.
* Recently seen users limit set to 100. for more check timeline.

**Removed**
* Removed Favorite title on World Tab
* Removed Edit Group name since we have the edit mode now.

**i18n**
* Added missing loc. keys for various ui elements.
* Added missing translation for the new sidebar.
* Added missing translation for some other ui elements.

**Fixed Bugs**
* Fixed an issue that caused VRCX database imports to fail when the database was larger than 200 MB.
* Fixed an issue that could cause VRCN to crash when using more than 256 MB of memory.
* Fixed a garbage collection issue that prevented unloaded pages from being properly cleaned up.
* Fixed an issue that could cause VRCN to crash when using the Avatar Search tab.
* Fixed an issue where VRCNDb filters did not work correctly when using VRCNDb in Avatar Search.
* Fixed missing rank data from avtrdb and icu database searches.
* Fixed other avatar related issues that showed missing data.
* Fixed missing metadata issues in avatar modals.
* Fixed rose avatar base not showing rank data when cached in sqlite.