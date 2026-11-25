# Fotos em PDF

Duas abas, tudo direto no navegador, sem servidor (nenhum arquivo sai do aparelho):

- **Fotos em PDF**: junta fotos num PDF A4 leve.
- **Juntar PDFs**: junta vários PDFs num só, sem perder qualidade. Endereço direto: https://italoleandrojs.github.io/fotos-pdf/#juntar
- **Escanear**: foto de papel vira folha reta e limpa, e as folhas viram um PDF A4. Endereço direto: https://italoleandrojs.github.io/fotos-pdf/#escanear

Endereço: https://italoleandrojs.github.io/fotos-pdf/ (com `noindex`, não aparece no Google).

## Como usar: Fotos em PDF

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

## Como usar: Juntar PDFs

1. Arraste os PDFs (ou toque em "Adicionar"). Entram por ordem de nome ("2" vem antes de "10").
2. Mude a ordem arrastando (no celular: segure um instante) ou pelas setas. O X tira da lista.
3. Dê um nome (em branco vira "PDFs juntos DD-MM-AAAA") e clique em Juntar. O arquivo baixa sozinho.

As folhas entram como são: mesmo tamanho (A4, A3, A1), mesmo giro, sem comprimir de novo. O tamanho final fica perto da soma dos arquivos.

- PDF protegido (com senha ou contra alteração) fica de fora, com aviso. Saída: abrir no leitor, imprimir em "Salvar como PDF" e adicionar a cópia.
- Assinatura digital: o selo continua aparecendo, mas a validade se perde (a tela avisa). Campos preenchidos e selos viram carimbo, senão sumiriam.
- Camadas do AutoCAD desligadas continuam desligadas. Links entre folhas continuam funcionando; o índice lateral (marcadores) não vem junto.
- Se um arquivo falhar na hora de juntar, nada é gerado e a tela diz qual foi.

Conferido em 24/11/2026 com 170 PDFs reais (ART, termos, plantas): 721 folhas comparadas ponto a ponto com as originais, nenhuma diferente.

## Como usar: Escanear

1. No celular, toque em "Tirar foto do documento" (abre a câmera normal, na qualidade cheia). No computador, arraste fotos que já existem.
2. O site acha as bordas da folha, endireita e limpa. Depois de cada foto da câmera, abre o ajuste: arraste as bolinhas até os cantos do papel (aparece uma lupa) e toque em Pronto. "Foto inteira" usa a foto toda; "Como estava" volta ao que o site achou.
3. Folha que o site não tem certeza fica marcada com "Confira os cantos". Toque na folha para ajustar.
4. Escolha a aparência (Colorido, Cinza ou P&B), dê um nome e gere o PDF.

Como funciona (tudo em `src/escaner/`, sem biblioteca de imagem):
- `bordas.ts`: acha a folha numa cópia de 480 px. Bordas por gradiente em brilho e cor, retas por votação, todos os quadriláteros possíveis e nota pelo quanto os 4 lados aparecem na foto. A borda da própria foto também vale como lado (folha que passou da foto).
- `limpar.ts`: tira a perspectiva, estima a luz do papel em blocos (ignorando foto, faixa colorida e letra grossa) e divide; P&B por limiar local, guardado em 1 bit.
- `pdf-escaner.ts`: A4 ocupa a página inteira; outro tamanho (nota, RG) fica centralizado.
- As contas rodam num Worker, para a tela não travar.

Medido em 25/11/2026 com 280 fotos sintéticas de papel (7 tipos de mesa, sombra, dedo, objetos) com os cantos conhecidos: 95,7% e 93,6% (fotos inéditas) com os 4 cantos certos (erro menor que 1,5% da foto). As erradas quase sempre ficam marcadas para conferir. Difícil: faixa escura no topo da folha em mesa escura, mesa quase branca, e folha que passa da borda da foto (23 de 33 certas).

Tamanho: 8 folhas deram 1,2 MB em Colorido e 202 KB em P&B. Colorido e Cinza saem a 200 dpi; P&B a 300 dpi.

## Como rodar

```
npm install
npm run dev      # http://localhost:5187/fotos-pdf/ (pela configuração "fotos-pdf" do app)
npm test         # testes das regras (EXIF, folhas, pixels, nomes, junção de PDFs, escâner)
npm run build    # gera dist/
```

Publicar: `npm run publicar` (gera o `dist/` e manda para o ramo `gh-pages`).

## Bibliotecas

- pdf-lib 1.17.1 (MIT): monta e junta os PDFs. A junção usa um campo interno dela (`traversedObjects`); se atualizar a versão, rode `npm test`.
- SortableJS (MIT): arrastar para mudar a ordem.
- heic-to (LGPL-3.0, com libheif): abre HEIC do iPhone. Só é baixada quando aparece uma foto HEIC.
- Fontes Schibsted Grotesk e IBM Plex Mono (SIL OFL), as mesmas do LS Campo.

## Validador de HTML

`.htmlvalidate.json` desliga só `doctype-style` e `void-style`: são preferência de escrita (`<!doctype html>` minúsculo e `<input />`), o navegador lê igual.
