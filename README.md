# MyDelivery Desktop

App de desktop (Electron) que abre o painel MyDelivery numa janela própria e
imprime os pedidos automaticamente na impressora do sistema — sem o pop-up do
navegador, sem WebUSB, sem `.bat`.

**Não altera nada do sistema web.** Só carrega `https://mydeliveryfood.com.br`.

## Rodar em modo teste (no seu Mac)

```bash
cd ~/Desktop/mydelivery-desktop
npm install
npm start
```

## Gerar instaladores (.exe do Windows + .dmg do Mac)

Você está no Mac, então o `.exe` sai pelo GitHub Actions (grátis):
1. Sobe esta pasta pra um repositório no GitHub.
2. Cria uma tag `v1.0.0` (ou usa "Run workflow" na aba Actions).
3. Baixa os instaladores em **Actions → artifacts**.

Localmente dá pra gerar só o do Mac: `npm run dist:mac`.

## Como a impressão funciona

`preload.js` expõe `window.myDeliveryDesktop.imprimir(bytes)`. O painel mantém
o formato de cupom existente. A partir da versão 1.0.19, no Windows o app
converte texto, formatação e QR fiscal para um documento e imprime pelo driver
instalado, inclusive OneNote. Mac/Linux conservam o envio RAW como padrão.

Use **Configurações → Impressão automática → Escolher impressora**, ou o menu
**MyDelivery → Configurar impressora**. A seleção e largura ficam salvas neste
computador. Selecione a **Impressora do caixa** e, em **Também imprimir na cozinha**,
a segunda impressora. Cada destino pode ter largura e modo próprios. As duas
precisam estar instaladas no computador que roda o app, inclusive quando forem
impressoras de rede. Selecionar a mesma impressora nos dois campos envia uma
única cópia. Em falha parcial, o app registra os destinos aceitos e retoma só os
pendentes na próxima tentativa do mesmo cupom (registro local por até sete dias).
Desative a segunda seleção para voltar a imprimir só no caixa.

O modo térmico direto ESC/POS continua disponível para impressoras
compatíveis. Se a impressora escolhida for removida, o app informa o problema
em vez de enviar para outro destino. Os envios são sequenciais.

O OneNote guarda o cupom em um bloco de anotações. Ele deve ser aberto e
configurado pelo usuário ao menos uma vez; o próprio OneNote pode solicitar o
destino. A confirmação do driver indica envio para a fila, não prova de papel
impresso. No modo driver, largura do papel e corte também dependem da
configuração do fabricante. O modo RAW usa `winspool` no Windows e `lp -o raw`
no Mac/Linux.

> Sem assinatura de código por enquanto: no Windows aparece o aviso "editor
> desconhecido" na instalação (normal, é só clicar em "Executar assim mesmo").
