# VISUAL_FUMAÇA_FOLHA_00

Shaders visuais em tela cheia que reagem ao **microfone** e ao **giroscópio**. Site estático, sem dependências, instalável (PWA) e com cache offline.

A tela mostra só o visual e um painel pequeno: botão **Ativar interações**, os dois controles de sensibilidade (áudio e giroscópio) e um botão para recolher o painel.

## Como reage

| Entrada | Efeito |
| --- | --- |
| Volume | ondas a partir do centro, brilho das linhas |
| Graves | amplitude da deformação; batidas dão um pulso |
| Médios | deslocamento de cor |
| Agudos | pontos brilhantes |
| Giroscópio | move o centro das formas (a posição ao ativar vira o zero) |
| Mouse / toque | mesmo efeito do giroscópio, para telas sem sensor |
| Onset (batidas/ataques) | flash radial no centro; chromatic aumenta |
| Chromatic aberration | liga/desliga no painel |

## Celular, tablet e desktop

- **Celular (< 640 px):** painel na largura toda, embaixo; renderização interna reduzida e limitada a 30 fps para poupar a GPU.
- **Tablet (640–1023 px):** painel em cartão de 380 px no canto; resolução interna adaptativa.
- **Desktop (≥ 1024 px):** painel de 400 px no canto; resolução interna adaptativa.
- **Celular deitado:** painel estreito, sliders lado a lado.
- Em telas compactas, a resolução interna começa mais alta para melhorar a nitidez e se ajusta conforme o desempenho.
- O controle **Resolução no celular** ajusta a preferência entre economia e nitidez; a adaptação automática pode reduzir a resolução para manter a fluidez.
- O shader usa menos camadas de ruído em celulares; a análise de pitch do microfone roda em intervalos, sem interromper a reação ao áudio.
- `prefers-reduced-motion` deixa a animação mais lenta.

## Executar no computador

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`. O microfone funciona em `localhost`; o giroscópio só existe em celular/tablet, então precisa de HTTPS no aparelho.

## Publicar no GitHub Pages

1. Envie os arquivos para a raiz do repositório.
2. **Settings → Pages → Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Abra o endereço `https://` gerado no celular.

## Arquivos

- `index.html`: página, canvas e painel.
- `assets/shaders.js`: shader (GLSL). É aqui que se muda o visual.
- `assets/interaction.js`: microfone (graves, médios, agudos, volume) e giroscópio.
- `assets/app.js`: renderização, resolução adaptativa, painel e service worker.
- `assets/styles.css`: layout responsivo.
- `manifest.webmanifest`, `icon.svg`, `icons/`: instalação como app.
- `service-worker.js`: cache offline. Ao mudar qualquer arquivo, aumente `CACHE_NAME`.
- `privacy.html`: nota de privacidade.
- `ESF-01.slnx`: agrupa os arquivos no Visual Studio 2026.
- `TESTES.md`: roteiro de testes manuais.

## Problemas comuns

- **Versão antiga aparecendo:** aumente `CACHE_NAME` no `service-worker.js`, ou desregistre em DevTools → Application → Service Workers.
- **Microfone sem reação:** permissões do site, HTTPS, e aumente **Sensibilidade áudio**.
- **Giroscópio sem reação:** no iOS a permissão de movimento só é pedida ao tocar em **Ativar interações**; se negada, recarregue a página.
