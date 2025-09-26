const DATA_URL = 'data/resources.json';
const STORAGE_KEY = 'wwhs-head-teacher-pinned';

const state = {
  categories: [],
  searchTerm: '',
  statusFilter: 'all',
  categoryFilter: 'all',
  showPinnedOnly: false,
  pinned: loadPinned(),
};

const elements = {
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  statusFilter: document.getElementById('status-filter'),
  categoryFilter: document.getElementById('category-filter'),
  pinnedToggle: document.getElementById('pinned-toggle'),
  categoryNav: document.getElementById('category-nav'),
  content: document.getElementById('content'),
  insights: document.getElementById('insights'),
  scrollTop: document.getElementById('scroll-top'),
  metrics: {
    totalSubjects: document.getElementById('metric-total-subjects'),
    allocated: document.getElementById('metric-allocated'),
    pinned: document.getElementById('metric-pinned'),
    progress: document.getElementById('metric-progress'),
    progressPath: document.getElementById('metric-progress-path'),
  },
};

let navObserver;

init().catch((error) => {
  console.error('Failed to initialise the super app', error);
  elements.content.innerHTML = `<div class="empty-state"><h2>Unable to load resources</h2><p>${error.message}</p></div>`;
});

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load data (${response.status})`);
  }

  const categories = await response.json();
  state.categories = categories;

  populateStatusOptions();
  populateCategoryFilter();
  renderCategoryNav();
  bindEventListeners();
  updateClearSearchButton();
  updateInsights();
  render();
}

function loadPinned() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.warn('Failed to read pinned resources from storage', error);
    return new Set();
  }
}

function savePinned() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.pinned]));
  } catch (error) {
    console.warn('Failed to persist pinned resources', error);
  }
}

function populateStatusOptions() {
  const years = new Set();
  state.categories.forEach((category) => {
    category.sections.forEach((section) => {
      const year = extractYear(section.status);
      if (year) years.add(year);
    });
  });

  const sortedYears = [...years].sort((a, b) => Number(b) - Number(a));
  sortedYears.forEach((year) => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    elements.statusFilter.append(option);
  });
}

function populateCategoryFilter() {
  state.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.code;
    option.textContent = `${category.code}. ${category.title}`;
    elements.categoryFilter.append(option);
  });
}

function renderCategoryNav() {
  elements.categoryNav.innerHTML = '';
  state.categories.forEach((category) => {
    const button = document.createElement('button');
    button.className = 'category-link';
    button.dataset.category = category.code;
    button.type = 'button';
    button.title = category.description || 'Overview coming soon.';
    button.innerHTML = `<span>${category.code}. ${category.title}</span><span>${category.sections.length}</span>`;
    button.addEventListener('click', () => scrollToCategory(category.code));
    elements.categoryNav.append(button);
  });
}

function bindEventListeners() {
  elements.searchInput.addEventListener('input', (event) => {
    state.searchTerm = event.target.value.trim();
    updateClearSearchButton();
    render();
  });

  elements.clearSearch.addEventListener('click', () => {
    state.searchTerm = '';
    elements.searchInput.value = '';
    updateClearSearchButton();
    render();
    elements.searchInput.focus();
  });

  elements.statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    render();
  });

  elements.categoryFilter.addEventListener('change', (event) => {
    state.categoryFilter = event.target.value;
    render();
  });

  elements.pinnedToggle.addEventListener('change', (event) => {
    state.showPinnedOnly = event.target.checked;
    render();
  });

  elements.scrollTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', handleScrollPosition);
}

function updateClearSearchButton() {
  if (state.searchTerm) {
    elements.clearSearch.classList.add('visible');
  } else {
    elements.clearSearch.classList.remove('visible');
  }
}

function handleScrollPosition() {
  if (window.scrollY > 300) {
    elements.scrollTop.classList.add('visible');
  } else {
    elements.scrollTop.classList.remove('visible');
  }
}

function scrollToCategory(code) {
  const target = document.getElementById(`category-${code}`);
  if (!target) return;
  target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  const filtered = filterData();
  elements.content.innerHTML = '';

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h2');
    title.textContent = 'No resources match your filters just yet';
    const message = document.createElement('p');
    message.textContent = 'Try clearing the search, selecting a different year, or turning off the pinned filter.';
    empty.append(title, message);
    elements.content.append(empty);
    updateInsights();
    updateCommandCentreStats();
    disconnectObserver();
    return;
  }

  const stats = computeStats(filtered);
  const statsElement = document.createElement('p');
  statsElement.className = 'search-stats';
  statsElement.textContent = `${stats.sectionCount} section${stats.sectionCount !== 1 ? 's' : ''} • ${stats.linkCount} link${
    stats.linkCount !== 1 ? 's' : ''
  } displayed`;
  if (state.showPinnedOnly) {
    statsElement.textContent += ' • showing pinned favourites';
  }
  elements.content.append(statsElement);

  const summaryGrid = document.createElement('div');
  summaryGrid.className = 'summary-grid';
  filtered.forEach((category) => {
    const template = document.getElementById('category-summary-template');
    const card = template.content.cloneNode(true);
    card.querySelector('h2').textContent = `${category.code}. ${category.title}`;
    const totalLinks = countLinks(category.sections);
    card.querySelector('.meta').textContent = `${category.sections.length} section${
      category.sections.length !== 1 ? 's' : ''
    } • ${totalLinks} link${totalLinks !== 1 ? 's' : ''}`;
    const description = card.querySelector('.description');
    description.textContent = '';
    const overviewLabel = document.createElement('strong');
    overviewLabel.textContent = 'Overview';
    description.append(overviewLabel);
    description.append(
      document.createTextNode(
        category.description ? ` ${category.description}` : ' No overview has been provided yet.'
      )
    );
    const linksContainer = card.querySelector('.links');
    linksContainer.innerHTML = '';
    category.links.forEach((link) => {
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = link.label;
      linksContainer.append(anchor);
    });
    if (!category.links.length) {
      const fallback = document.createElement('span');
      fallback.textContent = 'No quick links';
      linksContainer.append(fallback);
    }
    summaryGrid.append(card);
  });
  elements.content.append(summaryGrid);

  filtered.forEach((category) => {
    const details = document.createElement('details');
    details.className = 'category-section';
    details.id = `category-${category.code}`;
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = `${category.code}. ${category.title}`;
    const count = document.createElement('span');
    count.className = 'section-count';
    count.textContent = `${category.sections.length} section${category.sections.length !== 1 ? 's' : ''}`;
    summary.append(title, count);
    details.append(summary);

    const grid = document.createElement('div');
    grid.className = 'section-grid';

    if (category.description) {
      const overview = document.createElement('div');
      overview.className = 'category-overview';
      const heading = document.createElement('h3');
      heading.textContent = 'Overview';
      const copy = document.createElement('p');
      copy.textContent = category.description;
      overview.append(heading, copy);
      details.append(overview);
    }

    if (!category.sections.length) {
      const emptyCategory = document.createElement('p');
      emptyCategory.className = 'empty-state';
      emptyCategory.textContent = 'No sections within this category match your filters.';
      grid.append(emptyCategory);
    } else {
      category.sections.forEach((section) => {
        grid.append(createResourceCard(category, section));
      });
    }

    details.append(grid);
    if (shouldAutoOpenCategory(category)) {
      details.open = true;
    }
    elements.content.append(details);
  });

  updateInsights();
  updateCommandCentreStats();
  setupObserver();
}

function filterData() {
  const searchTerms = state.searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = (haystack) => searchTerms.every((term) => haystack.includes(term));

  return state.categories
    .map((category) => {
      const categorySearchText = `${category.code} ${category.title} ${category.description} ${category.links
        .map((link) => link.label)
        .join(' ')}`
        .toLowerCase();
      const categoryMatches = searchTerms.length ? matchesSearch(categorySearchText) : true;

      const sections = category.sections.filter((section) => {
        if (state.categoryFilter !== 'all' && state.categoryFilter !== category.code) {
          return false;
        }

        if (state.showPinnedOnly && !state.pinned.has(sectionKey(category.code, section.code))) {
          return false;
        }

        if (state.statusFilter !== 'all') {
          const year = extractYear(section.status);
          if (year !== state.statusFilter) {
            return false;
          }
        }

        if (!searchTerms.length) {
          return true;
        }

        const haystack = `${category.code} ${category.title} ${section.code} ${section.title} ${section.status} ${
          section.description
        } ${section.links.map((link) => `${link.label} ${link.url}`).join(' ')}`.toLowerCase();
        return matchesSearch(haystack);
      });

      return {
        ...category,
        sections,
        categoryMatches,
      };
    })
    .filter((category) => category.sections.length || category.categoryMatches);
}

function computeStats(categories) {
  let sectionCount = 0;
  let linkCount = 0;
  categories.forEach((category) => {
    sectionCount += category.sections.length;
    linkCount += countLinks(category.sections);
  });
  return { sectionCount, linkCount };
}

function countLinks(sections) {
  return sections.reduce((acc, section) => acc + section.links.length, 0);
}

function shouldAutoOpenCategory(category) {
  if (state.categoryFilter !== 'all') {
    return state.categoryFilter === category.code;
  }
  if (state.showPinnedOnly) {
    return category.sections.some((section) => state.pinned.has(sectionKey(category.code, section.code)));
  }
  if (state.searchTerm) {
    return category.sections.length > 0 || category.categoryMatches;
  }
  return false;
}

function createResourceCard(category, section) {
  const card = document.createElement('article');
  card.className = 'resource-card';
  card.id = `section-${category.code}-${section.code}`;

  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = `${section.code}. ${section.title}`;
  header.append(title);

  if (section.status) {
    const status = document.createElement('span');
    status.className = 'status-tag';
    status.textContent = section.status;
    header.append(status);
  }

  card.append(header);

  if (section.description) {
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = section.description;
    card.append(description);
  }

  if (section.links.length) {
    const linksList = document.createElement('div');
    linksList.className = 'links-list';
    section.links.forEach((link) => {
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = link.label;
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '↗';
      anchor.append(labelSpan, icon);
      linksList.append(anchor);
    });
    card.append(linksList);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const linkCount = document.createElement('span');
  linkCount.textContent = `${section.links.length} link${section.links.length !== 1 ? 's' : ''}`;
  footer.append(linkCount);

  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'pin-button';
  const key = sectionKey(category.code, section.code);
  const pinned = state.pinned.has(key);
  pinButton.innerHTML = pinned ? '★' : '☆';
  pinButton.classList.toggle('pinned', pinned);
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.setAttribute('aria-label', pinned ? 'Unpin section' : 'Pin section');
  pinButton.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePinned(key);
  });

  footer.append(pinButton);
  card.append(footer);
  return card;
}

function togglePinned(key) {
  if (state.pinned.has(key)) {
    state.pinned.delete(key);
  } else {
    state.pinned.add(key);
  }
  savePinned();
  render();
}

function extractYear(text = '') {
  const match = /20\d{2}/.exec(text);
  return match ? match[0] : null;
}

function sectionKey(categoryCode, sectionCode) {
  return `${categoryCode}-${sectionCode}`;
}

function setupObserver() {
  disconnectObserver();
  const options = { rootMargin: '-25% 0px -60% 0px', threshold: 0.1 };
  navObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const code = entry.target.id.replace('category-', '');
      document.querySelectorAll('.category-link').forEach((button) => {
        button.classList.toggle('active', button.dataset.category === code);
      });
    });
  }, options);

  document.querySelectorAll('.category-section').forEach((section) => navObserver.observe(section));
}

function disconnectObserver() {
  if (navObserver) {
    navObserver.disconnect();
    navObserver = undefined;
  }
  document.querySelectorAll('.category-link').forEach((button) => button.classList.remove('active'));
}

function updateInsights() {
  elements.insights.innerHTML = '';
  const totalSections = state.categories.reduce((acc, category) => acc + category.sections.length, 0);
  const totalLinks = state.categories.reduce((acc, category) => acc + countLinks(category.sections), 0);
  const years = new Set();
  state.categories.forEach((category) => {
    category.sections.forEach((section) => {
      const year = extractYear(section.status);
      if (year) years.add(year);
    });
  });
  const latestYear = [...years].sort((a, b) => Number(b) - Number(a))[0] || '—';

  const rows = [
    ['Total sections', totalSections],
    ['Stored links', totalLinks],
    ['Pinned favourites', state.pinned.size],
    ['Latest update', latestYear],
  ];

  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    elements.insights.append(dt, dd);
  });
}

function updateCommandCentreStats() {
  if (!elements.metrics) return;
  const totals = computeGlobalTotals();
  if (elements.metrics.totalSubjects) {
    elements.metrics.totalSubjects.textContent = totals.totalSections;
  }
  if (elements.metrics.allocated) {
    elements.metrics.allocated.textContent = totals.allocatedSections;
  }
  if (elements.metrics.pinned) {
    elements.metrics.pinned.textContent = totals.pinnedCount;
  }
  const progressValue = Math.round(totals.allocationProgress);
  const safeProgress = Math.max(0, Math.min(100, progressValue));
  if (elements.metrics.progress) {
    elements.metrics.progress.textContent = `${safeProgress}%`;
  }
  const remainder = Math.max(0, 100 - safeProgress);
  if (elements.metrics.progressPath) {
    elements.metrics.progressPath.setAttribute('stroke-dasharray', `${safeProgress}, ${remainder}`);
  }
}

function computeGlobalTotals() {
  let totalSections = 0;
  let allocatedSections = 0;
  state.categories.forEach((category) => {
    category.sections.forEach((section) => {
      totalSections += 1;
      if (section.links.length) {
        allocatedSections += 1;
      }
    });
  });
  const pinnedCount = state.pinned.size;
  const allocationProgress = totalSections ? (allocatedSections / totalSections) * 100 : 0;
  return { totalSections, allocatedSections, pinnedCount, allocationProgress };
}

