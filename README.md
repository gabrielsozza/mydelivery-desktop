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

`preload.js` expõe `window.myDeliveryDesktop.imprimir(bytes)`. Quando o sistema
web detecta que está rodando dentro do app, manda os bytes ESC/POS (o mesmo
cupom do WebUSB) por essa ponte, e o `print.js` envia direto pra impressora:
- **Mac/Linux:** `lp -o raw` (CUPS).
- **Windows:** `copy /b` pra impressora compartilhada (a calibrar com a
  impressora real; em alguns modelos trocamos por módulo nativo).

> Sem assinatura de código por enquanto: no Windows aparece o aviso "editor
> desconhecido" na instalação (normal, é só clicar em "Executar assim mesmo").
