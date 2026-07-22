/**
 * AICE Hub - Main Application
 */
(function() {
    'use strict';

    // ===== DOM Elements =====
    const modelGrid = document.getElementById('modelGrid');
    const filterTabs = document.getElementById('filterTabs');
    const searchInput = document.getElementById('searchInput');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('nav');
    const compareInput = document.getElementById('compareInput');
    const compareBtn = document.getElementById('compareBtn');
    const compareResults = document.getElementById('compareResults');

    // ===== State =====
    let currentFilter = 'all';
    let searchQuery = '';

    // ===== Render Model Cards =====
    function renderModelCards() {
        if (!modelGrid) return;

        const html = AI_MODELS.map(model => {
            const badgeHtml = model.badge
                ? `<div class="model-badge ${model.badge.class}">${model.badge.text}</div>`
                : '';

            const tagsHtml = model.tags
                .map(tag => `<span class="tag">${tag}</span>`)
                .join('');

            return `
                <div class="model-card" data-categories="${model.categories.join(' ')}" data-name="${model.name.toLowerCase()}" data-provider="${model.provider.toLowerCase()}">
                    <div class="model-card-header">
                        <div class="model-icon ${model.iconClass}">${model.iconLetter}</div>
                        ${badgeHtml}
                    </div>
                    <h3 class="model-name">${model.name}</h3>
                    <p class="model-provider">${model.provider}</p>
                    <p class="model-description">${model.description}</p>
                    <div class="model-specs">
                        <div class="spec">
                            <span class="spec-label">컨텍스트</span>
                            <span class="spec-value">${model.specs.context}</span>
                        </div>
                        <div class="spec">
                            <span class="spec-label">속도</span>
                            <span class="spec-value">${model.specs.speed}</span>
                        </div>
                    </div>
                    <div class="model-tags">${tagsHtml}</div>
                    <a href="pages/chat.html?model=${model.id}" class="btn btn-card">체험하기 →</a>
                </div>
            `;
        }).join('');

        modelGrid.innerHTML = html;
    }

    // ===== Filter & Search =====
    function applyFilters() {
        if (!modelGrid) return;
        const cards = modelGrid.querySelectorAll('.model-card');

        cards.forEach(card => {
            const categories = card.dataset.categories;
            const name = card.dataset.name;
            const provider = card.dataset.provider;

            const matchesFilter = currentFilter === 'all' || categories.includes(currentFilter);
            const matchesSearch = searchQuery === '' ||
                name.includes(searchQuery.toLowerCase()) ||
                provider.includes(searchQuery.toLowerCase());

            if (matchesFilter && matchesSearch) {
                card.classList.remove('hidden');
            } else {
                card.classList.add('hidden');
            }
        });
    }

    // Filter tab click
    if (filterTabs) {
        filterTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.filter-tab');
            if (!tab) return;

            filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            applyFilters();
        });
    }

    // Search input
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            applyFilters();
        });
    }

    // ===== Mobile Menu =====
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            nav.classList.toggle('active');
        });
    }

    // ===== Compare Mode =====
    document.querySelectorAll('.compare-model-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
        });
    });

    if (compareBtn) {
        compareBtn.addEventListener('click', () => {
            const prompt = compareInput.value.trim();
            if (!prompt) {
                alert('비교할 프롬프트를 입력해주세요.');
                return;
            }

            const selectedModels = document.querySelectorAll('.compare-model-chip.selected');
            if (selectedModels.length < 2) {
                alert('최소 2개의 모델을 선택해주세요.');
                return;
            }

            // Show demo response
            compareResults.classList.add('multi');
            compareResults.innerHTML = Array.from(selectedModels).map(chip => `
                <div class="compare-result-card">
                    <h4>${chip.textContent}</h4>
                    <p>⏳ API 연결 후 실제 응답을 받을 수 있습니다.\n\n현재 데모 모드: OpenRouter API 키를 설정하면 실시간 비교가 가능합니다.</p>
                </div>
            `).join('');
        });
    }

    // ===== Header Scroll Effect =====
    window.addEventListener('scroll', () => {
        const header = document.getElementById('header');
        if (!header) return;

        if (window.scrollY > 100) {
            header.style.background = 'rgba(10, 10, 15, 0.95)';
        } else {
            header.style.background = 'rgba(10, 10, 15, 0.85)';
        }
    });

    // ===== Smooth Scroll =====
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href === '#') return;

            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (nav) nav.classList.remove('active');
            }
        });
    });

    // ===== Initialize =====
    renderModelCards();

})();
