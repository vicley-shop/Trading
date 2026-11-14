/*
 * config.js — única parte que quizá necesites tocar.
 *
 * alias: nombre que usa esta página -> nombre del instrumento en biquote.io.
 * Si al abrir la página la plata (XAGUSD) sale como «no disponible», busca cómo la
 * llama biquote en https://biquote.io/api/symbols/search?q=silver y cambia el valor
 * de la derecha, por ejemplo:  XAGUSD: 'NOMBRE_QUE_APAREZCA'
 */
window.AT_CONFIG = window.AT_CONFIG || {};
window.AT_CONFIG.base = window.AT_CONFIG.base || 'https://biquote.io';
window.AT_CONFIG.alias = window.AT_CONFIG.alias || {
  XAUUSD: 'XAUUSD',
  XAGUSD: 'XAGUSD',
  EURUSD: 'EURUSD'
};
// Cliente SignalR para precios en vivo. Si no carga, la página consulta cada 2 s.
if (window.AT_CONFIG.signalrUrl === undefined) {
  window.AT_CONFIG.signalrUrl = 'https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.0/signalr.min.js';
}
