/**
 * AICE Hub - Configuration
 * Cloudflare Worker 배포 후 API_BASE_URL을 실제 URL로 변경하세요.
 */
const CONFIG = {
    // Cloudflare Worker URL
    API_BASE_URL: 'https://aicehub-api.kidongyun.workers.dev',

    // 데모 모드 (API_BASE_URL이 비어있으면 자동으로 데모 모드)
    get isDemoMode() {
        return !this.API_BASE_URL;
    }
};
