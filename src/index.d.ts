import type {IncomingMessage, ServerResponse} from 'node:http';

export declare const VERSAO: string;
export interface OpcoesEscambo {
  appId?: string;
  segredo?: string;
  caminho?: string;
  base?: string;
  log?: (evento: string, dados?: Record<string, unknown>) => void;
  token?: string;
  depoisDoResgate?: string;
  resgatar?: (ctx: {id: string; plano: string; plano_id: string; meses: number; teste: boolean; comprador: {nome: string}; token: string; req: unknown}) =>
    Promise<{usuario: string; destino?: string} | {redirecionar: string}>;
  situacao?: (ctx: {assinatura: string; usuario: string}) => Promise<'ativa' | 'cancelada' | 'desconhecida'>;
}
export interface RespostaPing {
  ok: boolean;
  estado?: 'aguardando' | 'conectado' | 'instavel' | 'desconectado';
  proximo_ping_s?: number;
  servidor_ts?: number;
  status?: number;
  erro?: string;
}
export interface StatusEscambo {
  appId: string; caminho: string; base: string; conectado: boolean;
  estado: string | null; ultimoPing: number | null; proximoPing: number | null; ultimoErro: string | null;
}
export interface Escambo {
  middleware(req: IncomingMessage & {originalUrl?: string}, res: ServerResponse, next?: () => void): void;
  responder(request: Request): Promise<Response | null>;
  ping(): Promise<RespostaPing>;
  iniciar(): void;
  parar(): void;
  status(): StatusEscambo;
  readonly caminho: string;
  readonly appId: string;
  readonly recursos: string[];
}
export declare function criarEscambo(opcoes?: OpcoesEscambo): Escambo;
export declare const PROTOCOLO: {
  pedido(app: string, desafio: string, ts: number): string;
  status(app: string, desafio: string, ts: number): string;
  ping(app: string, ts: number, nonce: string, corpoHash: string): string;
};
export default criarEscambo;
