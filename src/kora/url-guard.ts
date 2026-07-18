// Защита от SSRF для инструментов, которые тянут URL, заданный МОДЕЛЬЮ
// (рельса.scrape_url). Модель управляется пользовательским вводом, то есть
// пользователь по сути контролирует host и протокол запроса — классический
// SSRF: «прочитай http://169.254.169.254/latest/meta-data/...» увело бы
// сервер в облачные метаданные (кража креденшелов инстанса) или во
// внутренние сервисы Docker-сети (Postgres, админки), недостижимые снаружи.
//
// Защита: разрешаем только http/https и только публичные адреса. Хост
// резолвим в IP и проверяем КАЖДЫЙ полученный адрес — иначе имя, указывающее
// на 127.0.0.1/169.254.x, проскочило бы (в т.ч. DNS-rebinding). Резолвер
// инжектируется (тесты детерминированы без сети).

import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/** Приватные/зарезервированные IPv4-диапазоны, куда сервер ходить не должен. */
function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 «этот» хост
  if (a === 10) return true; // приватная
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, вкл. 169.254.169.254 (метаданные)
  if (a === 172 && b >= 16 && b <= 31) return true; // приватная
  if (a === 192 && b === 168) return true; // приватная
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast/reserved 224.0.0.0+
  return false;
}

/** Приватные/зарезервированные IPv6-диапазоны. */
function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedV4(mapped[1]);
  return false;
}

/** true — по этому IP ходить нельзя. Не-IP на входе тоже блокируем. */
export function isBlockedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true;
}

/**
 * Проверяет, безопасен ли URL для серверного фетча. Возвращает null, если
 * можно; строку-причину, если запрещено. Резолвит имя и проверяет ВСЕ
 * адреса (защита от «localhost»-имён и rebinding через несколько A-записей).
 */
export async function assertPublicUrl(rawUrl: string, lookupImpl?: LookupFn): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'некорректный URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `протокол ${u.protocol} запрещён (только http/https)`;
  }

  const host = u.hostname;
  const lowerHost = host.toLowerCase().replace(/\.$/, '');
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
    return 'локальный хост запрещён';
  }
  if (lowerHost === 'metadata.google.internal') {
    return 'metadata-хост запрещён';
  }

  // IP-литерал (v6 в URL приходит в скобках) — проверяем напрямую, без DNS.
  const ipLiteral = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(ipLiteral)) {
    return isBlockedIp(ipLiteral) ? 'адрес в приватном/зарезервированном диапазоне запрещён' : null;
  }

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await (lookupImpl ?? defaultLookup)(host);
  } catch {
    return 'не удалось разрешить имя хоста';
  }
  if (!addrs || addrs.length === 0) return 'имя хоста не разрешается';
  for (const a of addrs) {
    if (isBlockedIp(a.address)) return 'адрес хоста в приватном/зарезервированном диапазоне запрещён';
  }
  return null;
}
