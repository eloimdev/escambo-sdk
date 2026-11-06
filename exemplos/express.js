// npm i express github:eloimdev/escambo-sdk
import express from 'express';
import {criarEscambo} from '@rande/escambo';

const app = express();
const escambo = criarEscambo();      // lê ESCAMBO_APP_ID e ESCAMBO_SEGREDO do ambiente
app.use(escambo.middleware);         // responde em /escambo/status
escambo.iniciar();                   // avisa o Escambo que está no ar

app.get('/', (req, res) => res.send('Meu SaaS'));
app.listen(3000);
