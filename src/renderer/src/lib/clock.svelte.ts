/** A reactive clock that ticks every 10 s. */
export function createClock() {
  let now = $state(new Date());
  const timer = setInterval(() => (now = new Date()), 10_000);
  return {
    get time() {
      return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    },
    get date() {
      return now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    },
    get greeting() {
      const h = now.getHours();
      return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    },
    stop: () => clearInterval(timer),
  };
}
