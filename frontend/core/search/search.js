function searchLoadingText() {
    return t('search.loading', 'Loading...');
}

function searchNoResultsText() {
    return t('search.no_results', 'No results found');
}

function searchLoadMoreText() {
    return t('search.load_more', 'Load More');
}

function searchGroupMembersText(count) {
    return tf('worlds.groups.members', { count }, `${count} members`);
}

function doSearch(type, loadMore) {
    let query = '';
    let targetEl = '';
    let action = '';
    const sType = type === 'people' ? 'people' : type;

    if (type === 'worlds') {
        query = document.getElementById('searchWorldsInput').value.trim();
        targetEl = 'searchWorldsResults';
        action = 'vrcSearchWorlds';
    } else if (type === 'groups') {
        query = document.getElementById('searchGroupsInput').value.trim();
        targetEl = 'searchGroupsResults';
        action = 'vrcSearchGroups';
    } else if (type === 'people') {
        query = document.getElementById('searchPeopleInput').value.trim();
        targetEl = 'searchPeopleResults';
        action = 'vrcSearchUsers';
    }

    if (!query) return;

    if (!loadMore) {
        searchState[sType] = { query, offset: 0, results: [], hasMore: false };
        const skEl = document.getElementById(targetEl);
        skEl.classList.add('search-grid');
        skEl.innerHTML = sk(type === 'people' ? 'friend' : 'world', type === 'people' ? 5 : 3);
    } else {
        const btn = document.getElementById(targetEl).querySelector('.load-more-btn');
        if (btn) btn.textContent = searchLoadingText();
    }

    const sort = type === 'worlds' ? (document.getElementById('worldSortSelect')?.value || 'relevance') : undefined;
    sendToCS({ action, query: searchState[sType].query, offset: searchState[sType].offset, ...(sort !== undefined ? { sort } : {}) });
}

function _searchListMode(type) {
    if (typeof tlTableHtml !== 'function' || typeof tlTableRow !== 'function') return false;
    if (type === 'worlds') return typeof lvViewMode === 'function' && lvViewMode('worlds') === 'list';
    if (type === 'groups') return typeof lvViewMode === 'function' && lvViewMode('groups') === 'list';
    if (type === 'users')  return typeof _peopleListMode === 'function' && _peopleListMode();
    return false;
}

function renderSearchResults(type, results, offset, hasMore) {
    let targetEl = '';
    let sType = '';
    if (type === 'worlds') {
        targetEl = 'searchWorldsResults';
        sType = 'worlds';
    } else if (type === 'groups') {
        targetEl = 'searchGroupsResults';
        sType = 'groups';
    } else if (type === 'users') {
        targetEl = 'searchPeopleResults';
        sType = 'people';
    }

    const el = document.getElementById(targetEl);
    if (!el) return;

    const state = searchState[sType];
    if (offset === 0) state.results = results;
    else state.results = state.results.concat(results);
    state.offset = state.results.length;
    state.hasMore = hasMore;

    const listMode = _searchListMode(type);
    el.classList.toggle('search-grid', !listMode);

    if (state.results.length === 0) {
        el.innerHTML = `<div class="empty-msg">${esc(searchNoResultsText())}</div>`;
        return;
    }

    if (listMode) {
        let table = '';
        if (type === 'worlds') table = buildWorldsListHtml(state.results);
        else if (type === 'groups') table = buildGroupsListHtml(state.results);
        else if (type === 'users') table = buildPeopleListHtml(state.results);
        const more = state.hasMore
            ? `<div class="lv-more"><button class="vrcn-button load-more-btn" onclick="doSearch('${sType === 'people' ? 'people' : sType}',true)"><span class="msi" style="font-size:16px;">expand_more</span> ${esc(searchLoadMoreText())}</button></div>`
            : '';
        el.innerHTML = table + more;
        return;
    }

    let html = '';
    if (type === 'worlds') {
        html = state.results.map(w => renderWorldCard(w)).join('');
    } else if (type === 'groups') {
        html = state.results.map(g => `<div class="vrcn-content-card" onclick="openGroupDetail('${esc(g.id)}')">
            <div class="cc-bg"><img src="${imgThumb(g.bannerUrl, 256)||'fallback_cover.png'}" onerror="this.src='fallback_cover.png'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></div>
            <div class="cc-scrim"></div>
            <div class="cc-content">
                <div class="cc-name">${esc(g.name)}</div>
                <div class="cc-bottom-row">
                    <div class="cc-meta">${g.iconUrl ? `<div class="cc-group-icon" style="background-image:url('${cssUrl(imgThumb(g.iconUrl, 64))}')"></div>` : ''}<span class="msi" style="font-size:12px;">group</span> ${esc(searchGroupMembersText(g.memberCount))}</div>
                    ${g.shortCode ? `<span style="font-size:calc(10px + var(--fs-off, 0px));color:rgba(255,255,255,.4);">${esc(g.shortCode)}</span>` : ''}
                </div>
            </div>
        </div>`).join('');
    } else if (type === 'users') {
        html = state.results.map(u => {
            const trailing = u.isFriend
                ? `<span class="vrcn-badge bdg-friend" style="margin-left:auto;flex-shrink:0;"><span class="msi" style="font-size:10px;">check_circle</span>${esc(t('profiles.badges.friend', 'Friend'))}</span>`
                : '';
            return renderUserItem(u, `openFriendDetail('${esc(u.id)}')`, { trailing });
        }).join('');
    }

    if (state.hasMore) {
        const searchType = sType === 'people' ? 'people' : sType;
        html += `<div style="grid-column:1/-1;text-align:center;padding:12px;"><button class="vrcn-button load-more-btn" onclick="doSearch('${searchType}',true)" style="padding:8px 24px;"><span class="msi" style="font-size:16px;">expand_more</span> ${esc(searchLoadMoreText())}</button></div>`;
    }

    el.innerHTML = html;
}

function openUserDetail(userId) {
    openFriendDetail(userId);
}

function renderUserDetail(u) {
    renderFriendDetail(u);
}

function rerenderSearchTranslations() {
    if (searchState.worlds.query) {
        renderSearchResults('worlds', searchState.worlds.results, 0, searchState.worlds.hasMore);
    }
    if (searchState.groups.query) {
        renderSearchResults('groups', searchState.groups.results, 0, searchState.groups.hasMore);
    }
    if (searchState.people.query) {
        renderSearchResults('users', searchState.people.results, 0, searchState.people.hasMore);
    }
}

document.documentElement.addEventListener('languagechange', rerenderSearchTranslations);
