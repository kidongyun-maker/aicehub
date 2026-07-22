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
    let currentModel = AI_MODELS[0];
    let messages = [];

    // Get model from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const modelParam = urlParams.get('model');
    if (modelParam) {
        const found = AI_MODELS.find(m => m.id === modelParam);
        if (found) currentModel = found;
    }

    // ===== Render Sidebar =====
    function renderSidebar() {
        if (!sidebarModels) return;

        sidebarModels.innerHTML = AI_MODELS.map(model => `
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
                const model = AI_MODELS.find(m => m.id === item.dataset.modelId);
                if (model) selectModel(model);
            });
        });
    }

    // ===== Select Model =====
    function selectModel(model) {
        currentModel = model;
        
        // Update sidebar active state
        sidebarModels.querySelectorAll('.sidebar-model-item').forEach(item => {
            item.classList.toggle('active', item.dataset.modelId === model.id);
        });

        // Update header
        chatModelInfo.innerHTML = `
            <div class="model-icon ${model.iconClass}">${model.iconLetter}</div>
            <div>
                <h3>${model.name}</h3>
                <span>${model.provider}</span>
            </div>
        `;

        // Clear chat
        clearChat();
    }

    // ===== Clear Chat =====
    function clearChat() {
        messages = [];
        chatMessages.innerHTML = `
            <div class="chat-welcome">
                <h2>${currentModel.name}과 대화하세요</h2>
                <p>${currentModel.description}</p>
                <div class="chat-examples">
                    <button class="example-btn">"한국의 수도는 어디인가요?"</button>
                    <button class="example-btn">"피보나치 함수를 파이썬으로 작성해줘"</button>
                    <button class="example-btn">"이 코드를 리팩토링해줘"</button>
                </div>
            </div>
        `;

        // Re-attach example button handlers
        chatMessages.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.textContent.replace(/"/g, '');
                chatInput.value = text;
                sendMessage();
            });
        });
    }

    // ===== Add Message =====
    function addMessage(role, content) {
        messages.push({ role, content });

        const messageEl = document.createElement('div');
        messageEl.className = `message message-${role}`;

        const avatarText = role === 'user' ? 'U' : currentModel.iconLetter;
        const avatarClass = role === 'ai' ? currentModel.iconClass : '';

        messageEl.innerHTML = `
            <div class="message-avatar ${avatarClass}">${avatarText}</div>
            <div class="message-content">${formatContent(content)}</div>
        `;

        // Remove welcome screen if exists
        const welcome = chatMessages.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        chatMessages.appendChild(messageEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ===== Format Content =====
    function formatContent(content) {
        // Basic markdown-like formatting
        return content
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    // ===== Show Typing Indicator =====
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
    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        addMessage('user', text);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        showTyping();

        // Demo response (replace with actual API call later)
        setTimeout(() => {
            hideTyping();
            const demoResponse = getDemoResponse(text);
            addMessage('ai', demoResponse);
        }, 1000 + Math.random() * 1500);
    }

    // ===== Demo Responses =====
    function getDemoResponse(prompt) {
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('수도') || lowerPrompt.includes('서울')) {
            return `한국의 수도는 **서울**입니다.\n\n서울은 대한민국의 정치, 경제, 문화의 중심지로, 인구 약 950만 명이 거주하고 있습니다.`;
        }

        if (lowerPrompt.includes('피보나치') || lowerPrompt.includes('fibonacci')) {
            return `피보나치 수열을 구하는 파이썬 함수입니다:\n\n\`\`\`python\ndef fibonacci(n):\n    if n <= 0:\n        return []\n    elif n == 1:\n        return [0]\n    \n    fib = [0, 1]\n    for i in range(2, n):\n        fib.append(fib[i-1] + fib[i-2])\n    return fib\n\n# 사용 예시\nprint(fibonacci(10))\n# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]\n\`\`\`\n\n재귀 방식도 가능하지만, 큰 수에서는 메모이제이션을 사용하는 것이 효율적입니다.`;
        }

        if (lowerPrompt.includes('안녕') || lowerPrompt.includes('hello')) {
            return `안녕하세요! 저는 ${currentModel.name}입니다. 무엇을 도와드릴까요?\n\n코딩, 글쓰기, 분석, 번역 등 다양한 작업을 도와드릴 수 있습니다.`;
        }

        return `[데모 모드] ${currentModel.name}의 응답입니다.\n\nOpenRouter API 키를 설정하면 실제 AI 응답을 받을 수 있습니다.\n\n현재는 데모 모드로 작동 중이며, 실제 서비스에서는 ${currentModel.provider}의 ${currentModel.name} 모델이 응답합니다.\n\n설정 방법은 프로젝트 README를 참고하세요.`;
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

        // Auto-resize textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });
    }

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }

    // Example buttons
    document.querySelectorAll('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.textContent.replace(/"/g, '');
            chatInput.value = text;
            sendMessage();
        });
    });

    // Mobile menu
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            nav.classList.toggle('active');
        });
    }

    // ===== Initialize =====
    renderSidebar();
    clearChat();

})();
