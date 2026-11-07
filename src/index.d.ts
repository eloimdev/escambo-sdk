import type {IncomingMessage, ServerResponse} from 'node:http';

export declare const VERSAO: string;
type Resgatar = (ctx: {appId: string; id: string; plano: string; plano_id: string; meses: number; teste: boolean; comprador: {nome: string}; token: string; req: unknown}) =>
    Promise<{usuario: string; destino?: string} | {redirecionar: string}>;
type Situacao = (ctx: {appId: string; assinatura: string; usuario: string}) => Promise<'ativa' | 'cancelada' | 'desconhecida'>;
/** 0.4: depois que a troca acaba, essa conta virou cliente pagante? (true/false; só sim/não sai do seu servidor) */
/** 0.5: a troca desta conta está acabando ('perto', 7 dias antes) ou acabou ('fim'); oferta = a oferta de saída do dono, se ele escolheu mostrar no seu app. */
type FimDaTroca = (ctx: {appId: string; assinatura: string; usuario: string; plano: string; plano_id: string; meses: number; expira: number; momento: 'perto' | 'fim'; oferta: OfertaDeSaida | null}) => Promise<void>;
/** 0.5.1: oferta estruturada — aplique `desconto` (%) por `meses` no seu checkout (0 = enquanto a pessoa assinar). `texto` é a mesma oferta em português, pronta para mostrar. */
export interface OfertaDeSaida {nome: string | null; desconto: number | null; meses: number | null; texto: string; codigo: string | null; link: string | null;}
type Conversao = (ctx: {appId: string; assinatura: string; usuario: string}) => Promise<boolean | 'pagante' | 'nao' | 'desconhecida'>;
/** Um SaaS no Escambo. Vários SaaS do mesmo domínio = vários itens, cada um com o seu App ID. */
export interface AppEscambo {
  appId: string;
  segredo?: string;
  token?: string;
  resgatar?: Resgatar;
  situacao?: Situacao;
  conversao?: Conversao;
  fimDaTroca?: FimDaTroca;
  depoisDoResgate?: string;
}
export interface OpcoesEscambo {
  apps?: AppEscambo[];
  appId?: string;
  segredo?: string;
  caminho?: string;
  base?: string;
  log?: (evento: string, dados?: Record<string, unknown>) => void;
  token?: string;
  depoisDoResgate?: string;
  resgatar?: Resgatar;
  situacao?: Situacao;
  conversao?: Conversao;
  fimDaTroca?: FimDaTroca;
}
export interface RespostaPing {
  ok: boolean;
  estado?: 'aguardando' | 'conectado' | 'instavel' | 'desconectado';
  proximo_ping_s?: number;
  servidor_ts?: number;
  status?: number;
  erro?: string;
  appId?: string;
  /** Só com vários App IDs: o resultado de cada um. */
  apps?: RespostaPing[];
}
export interface StatusApp {
  appId: string; recursos: string[]; conectado: boolean;
  estado: string | null; ultimoPing: number | null; ultimoErro: string | null;
}
export interface StatusEscambo extends Partial<StatusApp> {
  caminho: string; base: string; recursos: string[]; proximoPing: number | null; apps: StatusApp[];
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
  readonly appIds: string[];
  readonly recursos: string[];
}
export declare function criarEscambo(opcoes?: OpcoesEscambo): Escambo;
export declare const PROTOCOLO: {
  pedido(app: string, desafio: string, ts: number): string;
  status(app: string, desafio: string, ts: number): string;
  ping(app: string, ts: number, nonce: string, corpoHash: string): string;
};
export default criarEscambo;
