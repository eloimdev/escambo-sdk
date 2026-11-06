import http from 'node:http';
import {criarEscambo} from '@rande/escambo';

const escambo = criarEscambo();
escambo.iniciar();
http.createServer((req, res) => {
  escambo.middleware(req, res, () => { res.end('Meu SaaS'); });
}).listen(3000);
