/**
 * AICE Hub - Chat Page
 */
(function() {
    'use strict';

    // ===== DOM =====
    const sidebarModels = document.getElementById('sidebarModels');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const chatModelInfo = document.getElementById('chatModelInfo');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('nav');

    // ===== State =====
    let currentModel = FREE_MODELS[0];
    let messages = []; // {role, content} 형태
    let isLoading = false;

    // Get model from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const modelParam = urlParams.get('model');
    if (modelParam) {
        const found = FREE_MODELS.find(m => m.id === modelParam);
        if (found) currentModel = found;
    }

    // ===== API Call =====
    async function callAI(model, messageHistory) {
        if (CONFIG.isDemoMode) {
            // 데모 모드 - 시뮬레이션
            await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
            return getDemoResponse(messageHistory[messageHistory.length - 1].content);
        }

        // 실제 API 호출
        const response = await fetch(CONFIG.API_BASE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model.openrouterId,
                messages: messageHistory
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'AI 응답 생성 중 오류가 발생했습니다.');
        }

        return data.content;
    }

    // ===== Render Sidebar =====
    function renderSidebar() {
        if (!sidebarModels) return;

        sidebarModels.innerHTML = FREE_MODELS.map(model => `
            <div class="sidebar-model-item ${model.id === currentModel.id ? 'active' : ''}" data-model-id="${model.id}">
                <div class="model-icon ${model.iconClass}">${model.iconLetter}</div>
                <div class="model-info">
                    <h4>${model.name}</h4>
                    <span>${model.provider}</span>
                </div>
            </div>
        `).join('');

        // Click handlers
        sidebarModels.querySelectorAll('.sidebar-model-item').forEach(item => {
            item.addEventListener('click', () => {
                const model = FREE_MODELS.find(m => m.id === item.dataset.modelId);
                if (model) selectModel(model);
            });
        });
    }

    // ===== Select Model =====
    function selectModel(model) {
        currentModel = model;
        
        sidebarModels.querySelectorAll('.sidebar-model-item').forEach(item => {
            item.classList.toggle('active', item.dataset.modelId === model.id);
        });

        chatModelInfo.innerHTML = `
            <div class="model-icon ${model.iconClass}">${model.iconLetter}</div>
            <div>
                <h3>${model.name}</h3>
                <span>${model.provider}</span>
            </div>
        `;

        clearChat();
    }

    // ===== Clear Chat =====
    function clearChat() {
        messages = [];
        chatMessages.innerHTML = `
            <div class="chat-welcome">
                <h2>${currentModel.name}과 대화하세요</h2>
                <p>${currentModel.description}</p>
                ${CONFIG.isDemoMode ? '<p class="demo-notice">⚠️ 데모 모드 — API 연결 후 실제 응답을 받을 수 있습니다.</p>' : ''}
                <div class="chat-examples">
                    <button class="example-btn">"한국의 수도는 어디인가요?"</button>
                    <button class="example-btn">"피보나치 함수를 파이썬으로 작성해줘"</button>
                    <button class="example-btn">"AI의 미래에 대해 설명해줘"</button>
                </div>
            </div>
        `;

        attachExampleHandlers();
    }

    function attachExampleHandlers() {
        chatMessages.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.textContent.replace(/"/g, '');
                chatInput.value = text;
                sendMessage();
            });
        });
    }

    // ===== Add Message to UI =====
    function addMessageToUI(role, content) {
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${role}`;

        const avatarText = role === 'user' ? 'U' : currentModel.iconLetter;
        const avatarClass = role === 'ai' ? currentModel.iconClass : '';

        messageEl.innerHTML = `
            <div class="message-avatar ${avatarClass}">${avatarText}</div>
            <div class="message-content">${formatContent(content)}</div>
        `;

        const welcome = chatMessages.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        chatMessages.appendChild(messageEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ===== Format Content =====
    function formatContent(content) {
        return content
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    // ===== Typing Indicator =====
    function showTyping() {
        const typingEl = document.createElement('div');
        typingEl.className = 'message message-ai';
        typingEl.id = 'typingIndicator';
        typingEl.innerHTML = `
            <div class="message-avatar ${currentModel.iconClass}">${currentModel.iconLetter}</div>
            <div class="message-content">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        chatMessages.appendChild(typingEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function hideTyping() {
        const typing = document.getElementById('typingIndicator');
        if (typing) typing.remove();
    }

    // ===== Send Message =====
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || isLoading) return;

        isLoading = true;
        chatSendBtn.disabled = true;

        // Add user message
        messages.push({ role: 'user', content: text });
        addMessageToUI('user', text);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        showTyping();

        try {
            const aiMessages = messages.map(m => ({
                role: m.role === 'ai' ? 'assistant' : m.role,
                content: m.content
            }));

            const response = await callAI(currentModel, aiMessages);
            hideTyping();
            messages.push({ role: 'ai', content: response });
            addMessageToUI('ai', response);
        } catch (error) {
            hideTyping();
            addMessageToUI('ai', `오류: ${error.message}`);
        } finally {
            isLoading = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
        }
    }

    // ===== Demo Responses =====
    function getDemoResponse(prompt) {
        const lower = prompt.toLowerCase();

        if (lower.includes('수도') || lower.includes('서울')) {
            return `한국의 수도는 **서울**입니다.\n\n서울특별시는 대한민국의 정치, 경제, 문화의 중심지로, 한강을 중심으로 남북으로 나뉘어 있습니다. 인구 약 950만 명이 거주하고 있으며, 수도권 전체로는 약 2,500만 명에 달합니다.`;
        }

        if (lower.includes('피보나치') || lower.includes('fibonacci')) {
            return '피보나치 수열을 구하는 파이썬 함수입니다:\n\n```python\ndef fibonacci(n):\n    """n번째까지의 피보나치 수열을 반환합니다."""\n    if n <= 0:\n        return []\n    elif n == 1:\n        return [0]\n    \n    fib = [0, 1]\n    for i in range(2, n):\n        fib.append(fib[i-1] + fib[i-2])\n    return fib\n\n# 사용 예시\nprint(fibonacci(10))\n# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]\n```\n\n시간복잡도는 O(n)이며, 재귀 대신 반복문을 사용해 효율적입니다.';
        }

        if (lower.includes('안녕') || lower.includes('hello') || lower.includes('hi')) {
            return `안녕하세요! 저는 ${currentModel.name}입니다. 무엇을 도와드릴까요?\n\n코딩, 글쓰기, 분석, 번역, 질문 응답 등 다양한 작업을 도와드릴 수 있어요.`;
        }

        if (lower.includes('ai') || lower.includes('미래') || lower.includes('인공지능')) {
            return `**AI의 미래**에 대해 몇 가지 핵심 트렌드를 말씀드릴게요:\n\n1. **멀티모달 AI** - 텍스트, 이미지, 음성, 영상을 통합 이해\n2. **에이전트 AI** - 스스로 계획하고 실행하는 자율 AI\n3. **온디바이스 AI** - 클라우드 없이 기기에서 바로 실행\n4. **오픈소스 확산** - Llama, Mistral 등 무료 고성능 모델 증가\n5. **규제와 안전** - AI 윤리, 편향 방지 기술 발전\n\n특히 무료 오픈소스 모델의 성능이 빠르게 향상되면서, 누구나 AI를 활용할 수 있는 시대가 오고 있습니다.`;
        }

        return `[데모 모드]\n\n이것은 **${currentModel.name}** (${currentModel.provider})의 시뮬레이션 응답입니다.\n\nCloudflare Worker를 배포하고 OpenRouter API 키를 설정하면 실제 AI 응답을 받을 수 있습니다.\n\n설정 방법은 \`worker/README.md\`를 참고하세요.`;
    }

    // ===== Event Listeners =====
    if (chatSendBtn) {
        chatSendBtn.addEventListener('click', sendMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });
    }

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            nav.classList.toggle('active');
        });
    }

    // ===== Initialize =====
    renderSidebar();
    clearChat();

})();
