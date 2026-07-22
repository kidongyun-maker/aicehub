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

            // 무료 모델: 체험 페이지로, 유료 모델: 외부 링크
            const actionHtml = model.isFree
                ? `<a href="pages/chat.html?model=${model.id}" class="btn btn-card">무료 체험하기 →</a>`
                : `<a href="${model.externalUrl}" target="_blank" class="btn btn-card btn-card-external">공식 사이트 →</a>`;

            return `
                <div class="model-card ${model.isFree ? '' : 'model-card-paid'}" data-categories="${model.categories.join(' ')}" data-name="${model.name.toLowerCase()}" data-provider="${model.provider.toLowerCase()}" data-free="${model.isFree}">
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
                    ${actionHtml}
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

    // API call for comparison
    async function callCompareAPI(modelId, prompt) {
        const model = FREE_MODELS.find(m => m.id === modelId);
        if (!model) return { model: modelId, error: '모델을 찾을 수 없습니다.' };

        if (CONFIG.isDemoMode) {
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
            return {
                model: model.name,
                content: `[데모] ${model.name}의 응답 시뮬레이션입니다.\n\nAPI 연결 후 "${prompt}"에 대한 실제 답변을 받을 수 있습니다.`
            };
        }

        try {
            const response = await fetch(CONFIG.API_BASE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model.openrouterId,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            return { model: model.name, content: data.content };
        } catch (error) {
            return { model: model.name, error: error.message };
        }
    }

    if (compareBtn) {
        compareBtn.addEventListener('click', async () => {
            const prompt = compareInput.value.trim();
            if (!prompt) {
                alert('비교할 프롬프트를 입력해주세요.');
                return;
            }

            const selectedChips = document.querySelectorAll('.compare-model-chip.selected');
            if (selectedChips.length < 2) {
                alert('최소 2개의 모델을 선택해주세요.');
                return;
            }

            // 로딩 상태
            compareBtn.disabled = true;
            compareBtn.textContent = '비교 중...';
            compareResults.classList.add('multi');
            compareResults.innerHTML = Array.from(selectedChips).map(chip => `
                <div class="compare-result-card">
                    <h4>${chip.textContent}</h4>
                    <div class="typing-indicator"><span></span><span></span><span></span></div>
                </div>
            `).join('');

            // 병렬 API 호출
            const modelIds = Array.from(selectedChips).map(chip => chip.dataset.model);
            const results = await Promise.all(
                modelIds.map(id => callCompareAPI(id, prompt))
            );

            // 결과 표시
            compareResults.innerHTML = results.map(result => `
                <div class="compare-result-card">
                    <h4>${result.model}</h4>
                    <p>${result.error ? `❌ ${result.error}` : formatCompareContent(result.content)}</p>
                </div>
            `).join('');

            compareBtn.disabled = false;
            compareBtn.textContent = '비교하기';
        });
    }

    function formatCompareContent(content) {
        return content
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
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
