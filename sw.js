/* ═══════════════════════════════════════════════════════════════════════
   SERVICE WORKER — App de Recebimento de Serviços (Borrachas Petro)
   ═══════════════════════════════════════════════════════════════════════

   É este arquivo que faz o Chrome oferecer "Instalar" e que deixa o app
   ABRIR SEM INTERNET. Sem ele, o navegador não reconhece a página como app.

   REGRA DE OURO DESTE ARQUIVO: a atualização SEMPRE tem que chegar.
   O jeito comum de fazer service worker é servir a cópia guardada primeiro
   ("cache-first"). É rápido, mas prende o usuário numa versão velha — a
   Suzana subiria o index.html novo no GitHub e os aparelhos continuariam
   abrindo o antigo, sem ninguém entender por quê.

   Aqui é o contrário:
     • a PÁGINA (index.html) é sempre buscada na internet primeiro, com
       'no-store', que ignora até o cache do próprio navegador. Só se a rede
       falhar é que a cópia guardada entra em cena.
     • os ÍCONES e o manifest, que praticamente não mudam, vêm da cópia
       guardada e se atualizam sozinhos por trás.

   Resultado: com internet, todo mundo abre a versão mais nova sem precisar
   de Ctrl+Shift+R. Sem internet, o app abre igual e os recebimentos ficam
   na fila para subir quando a rede voltar (a fila já existia no app).

   O QUE NÃO FUNCIONA OFFLINE (por serem de fora e não poderem ser guardados):
     • gerar PDF (a biblioteca jsPDF vem de um CDN);
     • ler e gravar na planilha Google (Apps Script);
     • sincronizar com o Firebase (SDK vem do gstatic.com).
   Nada disso quebra o app: o recebimento é salvo no aparelho e sobe depois.

   AO PUBLICAR UMA VERSÃO NOVA: troque o número em CACHE_NOME abaixo para o
   mesmo APP_VERSAO do index.html. Isso apaga a cópia antiga dos aparelhos.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_NOME = 'petro-recebimento-v21';

// O mínimo para o app abrir sem internet.
const ESSENCIAIS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon-64.png'
];

self.addEventListener('install', function (evento) {
  // Assume o comando na hora, sem esperar as abas antigas fecharem.
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CACHE_NOME).then(function (cache) {
      // addAll falha inteiro se UM arquivo faltar — por isso, um a um.
      return Promise.all(ESSENCIAIS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil((async function () {
    const nomes = await caches.keys();
    await Promise.all(nomes.map(function (n) {
      return (n !== CACHE_NOME) ? caches.delete(n) : null;   // limpa versões antigas
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (evento) {
  const req = evento.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Fora do nosso domínio (Apps Script, Firebase, CDN do jsPDF) o service
     worker não se mete: essas chamadas precisam ir direto para a rede, e
     guardar respostas de outro domínio só traria confusão. */
  if (url.origin !== self.location.origin) return;

  // ---- A PÁGINA: rede primeiro, sempre. A cópia guardada é o plano B. ----
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    evento.respondWith((async function () {
      try {
        const resposta = await fetch(req, { cache: 'no-store' });
        if (resposta && resposta.ok) {
          const cache = await caches.open(CACHE_NOME);
          cache.put('./index.html', resposta.clone());
        }
        return resposta;
      } catch (e) {
        const guardada = await caches.match('./index.html', { ignoreSearch: true });
        if (guardada) return guardada;
        throw e;
      }
    })());
    return;
  }

  // ---- Ícones e manifest: cópia guardada, com atualização por trás. ----
  evento.respondWith((async function () {
    const cache = await caches.open(CACHE_NOME);
    const guardada = await cache.match(req, { ignoreSearch: true });
    const daRede = fetch(req).then(function (resposta) {
      if (resposta && resposta.ok) cache.put(req, resposta.clone());
      return resposta;
    }).catch(function () { return null; });
    return guardada || (await daRede) || Response.error();
  })());
});

/* Permite que a página peça a troca imediata quando avisar
   "versão nova disponível". */
self.addEventListener('message', function (evento) {
  if (evento.data === 'ATUALIZAR_AGORA') self.skipWaiting();
});
