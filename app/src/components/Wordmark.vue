<template>
  <div class="wordmark" role="img" aria-label="Sevu">
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect x="5" y="13" width="22" height="16" rx="5" fill="currentColor" />
      <path d="M10 13V10a6 6 0 0 1 12 0v3" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />
      <circle cx="16" cy="21" r="2.4" fill="var(--bg)" />
    </svg>
    <span>sevu</span>
  </div>
</template>

<style scoped>
.wordmark { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); }
span { font-size: 24px; font-weight: 750; letter-spacing: -0.04em; }
</style>
