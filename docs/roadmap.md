# Ordem de implementação

Critério: primeiro o que serve de base para outras coisas, depois o que dá mais
resultado com menos esforço, e por último o que depende de login em serviços de
terceiros.

Esforço: **P** = pequeno (horas) · **M** = médio (um dia) · **G** = grande (vários dias)

---

## Onda 0: Fundações

O que destrava as ondas seguintes.

- [ ] **Teclas vivas** (M): uma ação pode mudar o próprio texto/ícone sozinha
  (contador, relógio, timer, música tocando), com limite de atualizações por segundo.
- [ ] **Teste de resistência do D6** (P): um dos projetos de referência relatou que
  o D6 para de desenhar depois de muitos envios. Antes de criar teclas que atualizam
  sozinhas, medir quanto ele aguenta e definir o intervalo mínimo entre atualizações.
- [ ] **Programa em foco** (P): detectar qual janela está ativa. Base do perfil
  automático e das ações de janela.

## Onda 1: Rápidas, úteis para todo mundo

Não dependem de nada.

- [ ] **Colar texto pronto** (P): e-mail, endereço, respostas frequentes; cola de uma
  vez (mais rápido e confiável que "Digitar texto").
- [ ] **Organizar janelas** (P): mandar para a esquerda/direita/outro monitor,
  maximizar, trazer um programa para frente, minimizar, fechar.
- [ ] **Energia e tela** (P): bloquear, suspender, desligar a tela, modo noturno,
  não perturbe.
- [ ] **Print com destino** (P): captura a tela ou uma área e salva numa pasta ou copia.
- [ ] **Ícone automático do programa** (P): "Abrir programa" usa o ícone do `.exe`.
- [ ] **Seletor de ações melhor** (P): recentes e favoritas no topo, busca por
  sinônimos ("mic" encontra "Mutar microfone"), uma linha de descrição em cada opção.

## Onda 2: Teclas vivas

Usa a Onda 0.

- [ ] **Contador** (P): toque soma, segurar zera; opção de gravar num `.txt` que o
  OBS lê como fonte de texto.
- [ ] **Cronômetro, timer e Pomodoro** (P): tempo correndo na tecla, aviso no fim.
- [ ] **Relógio, data e clima** (P): clima pelo Open-Meteo (não pede cadastro).
- [ ] **Toque duplo e ciclo** (M): toque duplo como terceira ação; ciclo = cada toque
  faz o próximo de uma lista (cena 1 → 2 → 3 → 1…).
- [ ] **Tecla de status** (M): consulta um site ou comando de tempos em tempos e muda
  de cor (site no ar, build passando, servidor rodando).

## Onda 3: Áudio do Windows

Precisa de uma biblioteca de áudio do Windows (ex.: pycaw).

- [ ] **Mutar o microfone do Windows com estado real** (M): funciona em qualquer
  programa e o ícone mostra o estado verdadeiro.
- [ ] **Volume por programa** (M): só o jogo, só o Spotify, só o Discord.
- [ ] **Trocar saída de áudio** (M): fone ↔ caixa, com o ícone mostrando a atual.
- [ ] **Tocando agora, com capa** (M): qualquer player que apareça nos controles de
  mídia do Windows, sem login.
- [ ] **Soundboard** (M): tocar um áudio escolhendo a saída (fone ou cabo virtual
  para a live); tocar de novo para parar.

## Onda 4: Modelos e perfis

- [ ] **Perfil automático** (M): troca de página conforme o programa em foco
  (usa a Onda 0).
- [ ] **Modelos de página prontos** (M): Reuniões (Teams, Meet, Zoom), Música,
  Escritório (Excel, Word), Photoshop, Premiere, Acessibilidade (frases prontas,
  lupa, ditado).
- [x] **Importar e exportar** (P): configuração inteira em .zip (com imagens), substituir tudo ou só adicionar as páginas. *(feito)*
- [ ] **Exportar uma página só** (P): para compartilhar uma página específica.

## Onda 5: Mais OBS e lógica

- [ ] **OBS** (M): ligar/desligar filtros, tocar/reiniciar mídia, trocar texto de
  fonte, marcar capítulo na gravação, tempo de live/gravação na tecla.
- [x] **Condição** (M): "se a cena atual for X, faça isto; senão, aquilo". *(feito junto com o editor novo)*
- [ ] **Área de transferência com slots** (P): guardar o que está copiado numa
  tecla e colar depois.

## Onda 6: Integrações com login

Por último: cada uma exige cadastrar um app no serviço e passar por login (OAuth).

- [ ] **Twitch** (G): criar clipe, marcador na live, rodar anúncio, mensagem no chat,
  trocar título/categoria.
- [ ] **Home Assistant** (M): luz, tomada, ar-condicionado, com o estado no ícone.

---

## Observações

- O **teste de resistência da Onda 0 é o ponto de maior risco**. Se o D6 aguentar
  pouco, as teclas vivas atualizam com menos frequência (por exemplo, a cada 5 s ou
  só quando o valor muda), mas continuam possíveis.
- Bibliotecas novas previstas: áudio do Windows (Onda 3), reprodução de som
  (soundboard) e, talvez, a API de mídia do Windows (tocando agora).

## Já feito

- [x] Driver do D6: teclas, imagens 112×112, envio rápido em lote
- [x] App com ações genéricas, OBS, Discord, páginas, segurar/soltar, config recarregável
- [x] Bandeja do Windows, iniciar com o Windows, reconexão automática
- [x] Editor visual: biblioteca de ações para arrastar, passos em sequência, bloco "Se… então… senão", desfazer, validação
- [x] Atalho para outro programa (combinação exclusiva por tecla, "apertar para falar")
- [x] Discord direto (Client ID): estado real de mudo e surdo no ícone
- [x] Salvamento automático e histórico de versões (voltar para qualquer versão)
