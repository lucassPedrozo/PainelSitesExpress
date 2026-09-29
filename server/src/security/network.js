/**
 * Política de rede do painel: ele roda na máquina de quem o usa e, no máximo,
 * na rede local. Guarda a chave da service account do Drive, o refresh_token do
 * Lovable e o token do GitHub — nada disso deve ser alcançável de fora.
 */
import { isIP } from "node:net";

const normalizeAddress = (address) => {
  const withoutZone = address.trim().toLowerCase().split("%")[0];
  return withoutZone.startsWith("::ffff:")
    ? withoutZone.slice(7)
    : withoutZone;
};

const isPrivateIpv4 = (address) => {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    )
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
};

const isPrivateIpv6 = (address) => {
  if (address === "::1") return true;
  if (/^f[cd][0-9a-f]{0,2}:/i.test(address)) return true;
  return /^fe[89ab][0-9a-f]?:/i.test(address);
};

/**
 * Só a própria máquina. A tela de configuração grava o token do GitHub em
 * disco, então ela é restrita ao loopback mesmo quando o painel escuta a LAN:
 * quem configura o painel é quem está sentado nele.
 */
export const isLoopbackAddress = (rawAddress) => {
  if (!rawAddress) return false;
  const address = normalizeAddress(rawAddress);
  if (address === "::1") return true;
  return isIP(address) === 4 && address.split(".")[0] === "127";
};

export const isLocalNetworkAddress = (rawAddress) => {
  if (!rawAddress) return false;
  const address = normalizeAddress(rawAddress);
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return false;
};

/**
 * A parte *de rede* da administração de chaves. A parte *de permissão* —
 * `administrar`, que a chave mestra sempre tem — é conferida antes, em
 * `canManageAccessKeys` no `index.js`, que chama esta função com `isAdmin`
 * já resolvido.
 *
 * O loopback vale por si: é a máquina que executa o painel. Pela rede local,
 * só com `isAdmin`. Endereço fora da LAN não passa em hipótese alguma: o
 * `localNetworkOnly` já barra antes, e esta é a segunda tranca, para o dia em
 * que aquele middleware mudar. A tela de configuração do deploy segue
 * exclusiva do loopback: ela grava o token do GitHub em disco, e isso é outro
 * grau de exposição.
 */
export const canAdministerAccessKeys = ({ remoteAddress, isAdmin }) => {
  if (isLoopbackAddress(remoteAddress)) return true;
  return Boolean(isAdmin) && isLocalNetworkAddress(remoteAddress);
};

const getHostname = (host) => {
  try {
    return new URL(`http://${host}`).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
  } catch {
    return "";
  }
};

export const isAllowedLocalHost = (host, allowedHosts = []) => {
  if (!host) return false;
  const hostname = getHostname(host);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isLocalNetworkAddress(hostname)) return true;
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  return allowedHosts.some((allowed) => hostname === allowed.toLowerCase());
};

export const evaluateNetworkAccess = (context) => {
  if (!isLocalNetworkAddress(context.remoteAddress)) {
    return { allowed: false, reason: "public-address" };
  }

  if (!isAllowedLocalHost(context.host, context.allowedHosts)) {
    return { allowed: false, reason: "invalid-host" };
  }

  if (context.hasForwardingHeaders) {
    return { allowed: false, reason: "forwarded-request" };
  }

  if (context.origin) {
    try {
      const origin = new URL(context.origin);
      if (
        !/^https?:$/.test(origin.protocol) ||
        origin.host.toLowerCase() !== context.host?.toLowerCase()
      ) {
        return { allowed: false, reason: "cross-origin" };
      }
    } catch {
      return { allowed: false, reason: "cross-origin" };
    }
  }

  return { allowed: true };
};

const hasForwardingHeaders = (req) =>
  Boolean(
    req.headers.forwarded ||
      req.headers["x-forwarded-for"] ||
      req.headers["x-forwarded-host"] ||
      req.headers["x-forwarded-proto"] ||
      req.headers["x-real-ip"],
  );

export const evaluateIncomingNetworkAccess = (req, allowedHosts = []) =>
  evaluateNetworkAccess({
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    origin: req.headers.origin,
    hasForwardingHeaders: hasForwardingHeaders(req),
    allowedHosts,
  });

/** Middleware do Express: barra tudo que não vem da máquina ou da LAN. */
export const localNetworkOnly = (allowedHosts = []) => (req, res, next) => {
  if (evaluateIncomingNetworkAccess(req, allowedHosts).allowed) return next();

  res.status(403).type("text/plain").send("Acesso permitido somente pela rede local.");
};
