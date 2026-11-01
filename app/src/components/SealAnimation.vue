<template>
  <div class="seal" aria-hidden="true">
    <svg viewBox="0 0 120 120" width="132" height="132">
      <circle class="pulse" cx="60" cy="60" r="54" fill="none" stroke="var(--sealed)" stroke-width="2" />
      <circle class="disc" cx="60" cy="60" r="46" fill="var(--sealed-bg)" />
      <path class="shackle" d="M44 56V46a16 16 0 0 1 32 0v10" fill="none" stroke="var(--sealed)" stroke-width="7" stroke-linecap="round" />
      <rect class="body" x="36" y="54" width="48" height="36" rx="9" fill="var(--sealed)" />
      <path class="tick" d="M49 72l8 8 15-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style scoped>
.seal { display: grid; place-items: center; padding: 8px 0; }
.disc { transform-origin: 60px 60px; animation: pop 0.45s var(--ease) both; }
.body { transform-origin: 60px 72px; animation: pop 0.45s 0.1s var(--ease) both; }
.shackle { animation: close 0.5s 0.35s cubic-bezier(0.5, 0, 0.2, 1.4) both; }
.tick { stroke-dasharray: 40; stroke-dashoffset: 40; animation: draw 0.35s 0.85s var(--ease) forwards; }
.pulse { transform-origin: 60px 60px; opacity: 0; animation: pulse 0.9s 0.8s ease-out; }
@keyframes pop { from { transform: scale(0.6); opacity: 0; } }
@keyframes close { from { transform: translateY(-14px); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes pulse { 0% { opacity: 0.6; transform: scale(0.85); } 100% { opacity: 0; transform: scale(1.15); } }
@media (prefers-reduced-motion: reduce) { .tick { stroke-dashoffset: 0; } }
</style>
