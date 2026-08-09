// Central search debounce registry.

let DEBOUNCE_SEARCH_MS = 500;

function _buildSearchDebouncers() {
    window._dbFilterFriends    = debounceAnim(filterFriendsList,  DEBOUNCE_SEARCH_MS, 'vrcFriendSearchInput');
    window._dbFilterAllFriends = debounceAnim(() => { _peopleAllPage = 0;     filterAllFriends(); },    DEBOUNCE_SEARCH_MS, 'allFriendSearchInput');
    window._dbFilterBlocked    = debounceAnim(() => { _peopleBlockedPage = 0; filterModList('block'); }, DEBOUNCE_SEARCH_MS, 'blockedSearch');
    window._dbFilterMuted      = debounceAnim(() => { _peopleMutedPage = 0;   filterModList('mute'); },  DEBOUNCE_SEARCH_MS, 'mutedSearch');
    window._dbFilterFavFriends = debounceAnim(filterFavFriends,                                          DEBOUNCE_SEARCH_MS, 'favFriendSearchInput');
    window._dbFilterInvite     = debounceAnim(filterInviteList,   DEBOUNCE_SEARCH_MS, 'inviteSearch');
    window._dbFdGroups         = debounceAnim(() => { window._fdGroupsPage = 0;        filterFdGroups(); },        DEBOUNCE_SEARCH_MS, 'fdGroupsSearch');
    window._dbFdMutuals        = debounceAnim(() => { window._fdMutualsPage = 0;        filterFdMutuals(); },       DEBOUNCE_SEARCH_MS, 'fdMutualsSearch');
    window._dbFdMutualsGroups  = debounceAnim(() => { window._fdMutualsGroupsPage = 0;  filterFdMutualsGroups(); }, DEBOUNCE_SEARCH_MS, 'fdMutualsGroupsSearch');
    window._dbMypGroups        = debounceAnim(() => { _mypGroupsPage = 0;              filterMypGroups(); },       DEBOUNCE_SEARCH_MS, 'mypGroupsSearch');
}

function rebuildSearchDebouncers(ms) {
    DEBOUNCE_SEARCH_MS = ms || 500;
    _buildSearchDebouncers();
    if (typeof SmartSearch !== 'undefined') SmartSearch.rebuildDebouncer();
}

// Sidebar
window._dbFilterFriends    = debounceAnim(filterFriendsList,  DEBOUNCE_SEARCH_MS, 'vrcFriendSearchInput');

// People Tab
window._dbFilterAllFriends = debounceAnim(() => { _peopleAllPage = 0;     filterAllFriends(); },    DEBOUNCE_SEARCH_MS, 'allFriendSearchInput');
window._dbFilterBlocked    = debounceAnim(() => { _peopleBlockedPage = 0; filterModList('block'); }, DEBOUNCE_SEARCH_MS, 'blockedSearch');
window._dbFilterMuted      = debounceAnim(() => { _peopleMutedPage = 0;   filterModList('mute'); },  DEBOUNCE_SEARCH_MS, 'mutedSearch');
window._dbFilterFavFriends = debounceAnim(filterFavFriends,                                          DEBOUNCE_SEARCH_MS, 'favFriendSearchInput');

// Invite Modal
window._dbFilterInvite     = debounceAnim(filterInviteList,   DEBOUNCE_SEARCH_MS, 'inviteSearch');

// Profile Modal
window._dbFdGroups         = debounceAnim(() => { window._fdGroupsPage = 0;        filterFdGroups(); },        DEBOUNCE_SEARCH_MS, 'fdGroupsSearch');
window._dbFdMutuals        = debounceAnim(() => { window._fdMutualsPage = 0;        filterFdMutuals(); },       DEBOUNCE_SEARCH_MS, 'fdMutualsSearch');
window._dbFdMutualsGroups  = debounceAnim(() => { window._fdMutualsGroupsPage = 0;  filterFdMutualsGroups(); }, DEBOUNCE_SEARCH_MS, 'fdMutualsGroupsSearch');
window._dbMypGroups        = debounceAnim(() => { _mypGroupsPage = 0;              filterMypGroups(); },       DEBOUNCE_SEARCH_MS, 'mypGroupsSearch');
