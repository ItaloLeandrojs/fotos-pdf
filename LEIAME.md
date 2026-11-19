# Fotos em PDF

Junta fotos num PDF A4 leve, direto no navegador. As fotos não saem do aparelho: são lidas, reduzidas e juntadas no próprio navegador, sem servidor.

Endereço: https://italoleandrojs.github.io/fotos-pdf/ (com `noindex`, não aparece no Google).

## Como usar

1. Arraste as fotos para a página (ou toque em "Arraste as fotos para cá" / "Adicionar"). Aceita JPG, PNG, WebP e HEIC do iPhone. Ctrl+V também cola uma imagem.
2. Arrume a ordem arrastando as fotos (no celular: segure um instante e arraste). No teclado: selecione a foto e use Alt + setas; Delete tira a foto.
3. Gire ou tire uma foto pelos botões embaixo dela.
4. Escolha quantas fotos por folha (1, 2 ou 4) e o tamanho do arquivo.
5. Dê um nome (se deixar em branco vira "fotos DD-MM-AAAA") e clique em Gerar PDF. O arquivo baixa sozinho.

As fotos entram na ordem da data em que foram tiradas (EXIF). Os botões "Ordenar por data" e "Ordenar por nome" refazem a ordem.

## Tamanho do arquivo

| Opção | O que faz | 21 fotos de obra (37 MB) |
|---|---|---|
| Menor | 150 dpi na folha, JPEG 72 | 4,4 MB |
| Equilibrado (padrão) | 200 dpi na folha, JPEG 80 | 9,4 MB |
| Máxima | sem reduzir; JPEG que já está de pé entra como está | 37 MB |

Com 2 fotos por folha o Equilibrado deu 3 MB e com 4 por folha deu 2,4 MB, porque cada foto ocupa menos espaço na folha e precisa de menos pixels. O carimbo verde de data e coordenada continua legível em todos (conferido ampliando o PDF).

O tamanho em pixels sai do espaço que a foto ocupa na folha: uma foto nunca é aumentada, e uma foto pequena entra no tamanho dela.

## Como rodar

```
npm install
npm run dev      # http://localhost:5187/fotos-pdf/ (pela configuração "fotos-pdf" do app)
npm test         # testes das regras (EXIF, folhas, pixels, nomes)
npm run build    # gera dist/
```

Publicar: `npm run publicar` (gera o `dist/` e manda para o ramo `gh-pages`).

## Bibliotecas

- pdf-lib (MIT): monta o PDF.
- SortableJS (MIT): arrastar para mudar a ordem.
- heic-to (LGPL-3.0, com libheif): abre HEIC do iPhone. Só é baixada quando aparece uma foto HEIC.
- Fontes Schibsted Grotesk e IBM Plex Mono (SIL OFL), as mesmas do LS Campo.

## Validador de HTML

`.htmlvalidate.json` desliga só `doctype-style` e `void-style`: são preferência de escrita (`<!doctype html>` minúsculo e `<input />`), o navegador lê igual.
