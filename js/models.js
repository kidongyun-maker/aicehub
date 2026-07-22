/**
 * AI Model Data - 무료 모델 중심
 * OpenRouter에서 무료로 사용 가능한 모델 + 유료 모델 정보(링크만)
 */

// 무료 체험 가능 모델 (OpenRouter free tier)
const FREE_MODELS = [
    {
        id: 'llama-3.1-8b',
        name: 'Llama 3.1 8B',
        provider: 'Meta',
        iconClass: 'model-icon-meta',
        iconLetter: 'L',
        badge: { text: '무료', class: 'model-badge-free' },
        description: '빠르고 가벼운 오픈소스 모델. 일상 대화와 간단한 코딩에 적합합니다.',
        specs: { context: '128K', speed: '매우 빠름' },
        tags: ['대화', '코딩', '빠름'],
        categories: ['chat', 'code'],
        openrouterId: 'meta-llama/llama-3.1-8b-instruct:free',
        isFree: true
    },
    {
        id: 'llama-3.2-3b',
        name: 'Llama 3.2 3B',
        provider: 'Meta',
        iconClass: 'model-icon-meta',
        iconLetter: 'L',
        badge: { text: '무료', class: 'model-badge-free' },
        description: '초경량 모델. 빠른 응답이 필요한 간단한 작업에 최적화되어 있습니다.',
        specs: { context: '128K', speed: '초고속' },
        tags: ['대화', '빠름', '경량'],
        categories: ['chat'],
        openrouterId: 'meta-llama/llama-3.2-3b-instruct:free',
        isFree: true
    },
    {
        id: 'gemma-2-9b',
        name: 'Gemma 2 9B',
        provider: 'Google',
        iconClass: 'model-icon-google',
        iconLetter: 'G',
        badge: { text: '무료', class: 'model-badge-free' },
        description: 'Google의 경량 오픈 모델. 균형 잡힌 성능과 빠른 추론 속도를 제공합니다.',
        specs: { context: '8K', speed: '빠름' },
        tags: ['대화', '추론', '효율'],
        categories: ['chat', 'reasoning'],
        openrouterId: 'google/gemma-2-9b-it:free',
        isFree: true
    },
    {
        id: 'phi-3-mini',
        name: 'Phi-3 Mini',
        provider: 'Microsoft',
        iconClass: 'model-icon-microsoft',
        iconLetter: 'P',
        badge: { text: '무료', class: 'model-badge-free' },
        description: '소형 모델 중 최고 성능. 추론과 코딩에서 큰 모델에 준하는 능력을 보입니다.',
        specs: { context: '128K', speed: '빠름' },
        tags: ['추론', '코딩', '효율'],
        categories: ['chat', 'code', 'reasoning'],
        openrouterId: 'microsoft/phi-3-mini-128k-instruct:free',
        isFree: true
    },
    {
        id: 'mistral-7b',
        name: 'Mistral 7B',
        provider: 'Mistral AI',
        iconClass: 'model-icon-mistral',
        iconLetter: 'M',
        badge: { text: '무료', class: 'model-badge-free' },
        description: '유럽의 효율적인 오픈소스 모델. 다국어 지원이 뛰어납니다.',
        specs: { context: '32K', speed: '빠름' },
        tags: ['다국어', '대화', '효율'],
        categories: ['chat', 'code'],
        openrouterId: 'mistralai/mistral-7b-instruct:free',
        isFree: true
    },
    {
        id: 'qwen-2.5-7b',
        name: 'Qwen 2.5 7B',
        provider: 'Alibaba',
        iconClass: 'model-icon-qwen',
        iconLetter: 'Q',
        badge: { text: '무료', class: 'model-badge-free' },
        description: '중국어와 영어에 강한 모델. 코딩과 수학 능력도 뛰어납니다.',
        specs: { context: '32K', speed: '빠름' },
        tags: ['다국어', '코딩', '수학'],
        categories: ['chat', 'code', 'reasoning'],
        openrouterId: 'qwen/qwen-2.5-7b-instruct:free',
        isFree: true
    }
];

// 유료 모델 (정보 + 공식 사이트 링크만)
const PAID_MODELS = [
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'OpenAI',
        iconClass: 'model-icon-openai',
        iconLetter: 'G',
        badge: { text: '유료', class: 'model-badge-popular' },
        description: '가장 강력한 멀티모달 모델. 텍스트, 이미지, 음성을 모두 이해하고 생성합니다.',
        specs: { context: '128K', speed: '빠름' },
        tags: ['대화', '코딩', '추론'],
        categories: ['chat', 'code', 'reasoning'],
        externalUrl: 'https://chat.openai.com',
        isFree: false
    },
    {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'Anthropic',
        iconClass: 'model-icon-anthropic',
        iconLetter: 'C',
        badge: { text: '유료', class: 'model-badge-popular' },
        description: '뛰어난 코딩 능력과 긴 문맥 이해. 안전하고 정확한 답변을 제공합니다.',
        specs: { context: '200K', speed: '빠름' },
        tags: ['대화', '코딩', '분석'],
        categories: ['chat', 'code', 'reasoning'],
        externalUrl: 'https://claude.ai',
        isFree: false
    },
    {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'Google',
        iconClass: 'model-icon-google',
        iconLetter: 'G',
        badge: { text: '유료', class: 'model-badge-popular' },
        description: '100만 토큰 컨텍스트 윈도우. 긴 문서와 영상 분석에 탁월합니다.',
        specs: { context: '1M', speed: '보통' },
        tags: ['대화', '분석', '멀티모달'],
        categories: ['chat', 'reasoning'],
        externalUrl: 'https://gemini.google.com',
        isFree: false
    },
    {
        id: 'mistral-large',
        name: 'Mistral Large',
        provider: 'Mistral AI',
        iconClass: 'model-icon-mistral',
        iconLetter: 'M',
        badge: { text: '유료', class: 'model-badge-popular' },
        description: '유럽 최고의 AI. 다국어 지원이 뛰어나며 효율적인 추론이 가능합니다.',
        specs: { context: '128K', speed: '빠름' },
        tags: ['다국어', '코딩', '추론'],
        categories: ['chat', 'code', 'reasoning'],
        externalUrl: 'https://chat.mistral.ai',
        isFree: false
    }
];

// 전체 모델 (무료 먼저)
const AI_MODELS = [...FREE_MODELS, ...PAID_MODELS];
