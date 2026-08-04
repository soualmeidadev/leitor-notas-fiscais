# Leitor de notas fiscais no Gmail

Aplicação Node.js que consulta a caixa de entrada do Gmail em modo somente leitura, identifica mensagens com documentos fiscais e salva anexos XML/PDF localmente. Ela não apaga, move, marca nem modifica e-mails.

## Requisitos

- Node.js 20 ou superior
- npm
- Uma conta no Google Cloud com acesso à conta Gmail monitorada

## 1. Instalação

```bash
npm install
cp .env.example .env
```

Os valores padrão de `.env.example` funcionam com a estrutura deste projeto. Ajuste-os somente quando necessário.

## 2. Configuração no Google Cloud

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie ou selecione um projeto.
2. Em **APIs e serviços > Biblioteca**, procure por **Gmail API** e clique em **Ativar**.
3. Em **APIs e serviços > Tela de consentimento OAuth**, configure o nome do aplicativo e os dados solicitados.
4. Se o aplicativo estiver no modo **Externo/Teste**, adicione `manutencaoidgm@gmail.com` em **Usuários de teste**.
5. Adicione o escopo `https://www.googleapis.com/auth/gmail.readonly`. Este projeto não solicita permissão de escrita.
6. Em **APIs e serviços > Credenciais**, crie um **ID do cliente OAuth**.

### Tipo de credencial

Prefira **Aplicativo para computador** para execução interativa em Codespaces ou numa máquina local. Também é possível usar **Aplicativo da Web**, desde que um URI de redirecionamento (por exemplo, `http://localhost:3000`) esteja cadastrado. O script mostra a URL de autorização e aceita tanto o código quanto a URL completa de redirecionamento colada no terminal.

Baixe o JSON, renomeie-o para `credentials.json` e coloque-o na raiz:

```text
leitor-notas-fiscais/credentials.json
```

Nunca compartilhe esse arquivo.

## 3. Autorização OAuth

Execute:

```bash
npm run authorize
```

Abra a URL exibida, entre especificamente com `manutencaoidgm@gmail.com`, aceite o escopo somente leitura e cole no terminal o código ou a URL de redirecionamento. O token será salvo em `tokens/token.json`.

Se o Google não mostrar um código diretamente, copie a URL completa para a qual o navegador foi redirecionado. Em Codespaces, não é necessário que a página local carregue para que o parâmetro `code` esteja na barra de endereço.

## 4. Execução

```bash
npm start
```

A primeira verificação acontece imediatamente. Depois disso, `node-cron` segue `EMAIL_CHECK_CRON`. O padrão verifica a cada 30 segundos:

```dotenv
EMAIL_CHECK_CRON=*/30 * * * * *
```

O cron aceita seis campos quando há segundos. Exemplos: `0 */5 * * * *` executa a cada cinco minutos; `0 0 * * * *` executa no início de cada hora. Reinicie a aplicação após alterar `.env`.

## Notificações pelo Telegram

A integração envia um aviso e, em seguida, cada XML/PDF fiscal novo como documento. Ela usa diretamente a API HTTPS do Telegram e não requer biblioteca adicional.

1. No Telegram, abra uma conversa com `@BotFather`.
2. Envie `/newbot`, escolha o nome e o identificador do bot e guarde o token fornecido.
3. Abra uma conversa privada com o bot criado e envie `/start`.
4. Consulte `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` no navegador e procure o valor numérico em `message.chat.id`. Esse é o `TELEGRAM_CHAT_ID`.
5. Configure o `.env`:

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=token-fornecido-pelo-botfather
TELEGRAM_CHAT_ID=id-numerico-do-chat
```

Reinicie com `npm start`. Use um chat privado ou grupo restrito: notas fiscais podem conter dados pessoais e empresariais. O envio usa proteção contra encaminhamento/salvamento oferecida pelo Telegram, mas isso não substitui o controle de acesso ao chat. Nunca compartilhe o token do bot nem o coloque no GitHub.

Se o Telegram estiver indisponível, o erro será registrado no histórico e a leitura do Gmail continuará. Anexos já registrados por SHA-256 não serão reenviados.

## Como funciona

A consulta padrão é `in:inbox newer_than:7d has:attachment`. A aplicação percorre todas as páginas (`GMAIL_MAX_RESULTS` define o tamanho de cada página), interpreta MIME aninhado e pontua assunto, texto, remetente e anexos. Um XML reconhecido como NF-e, NFS-e ou CT-e confirma imediatamente o documento. Um PDF genérico, sozinho, não é aceito.

Os arquivos ficam organizados por data do e-mail:

```text
downloads/ANO/MÊS/ID-DA-MENSAGEM/arquivo.xml
```

Mensagens processadas ficam registradas em `data/processed-emails.json`. Hashes SHA-256 impedem que um anexo já registrado seja salvo novamente. Registros com `ERROR` também são considerados vistos; remova manualmente apenas o registro específico se quiser tentar aquela mensagem de novo.

## Teste com e-mails de exemplo

1. Envie para a conta monitorada um e-mail com assunto `NF-e de teste` e anexe um XML de homologação, sem dados fiscais reais.
2. Envie outro e-mail com um PDF genérico e assunto sem termos fiscais; ele deve aparecer como `IGNORED`.
3. Execute `npm start` e confira os logs e a pasta `downloads/`.
4. Reinicie o processo: as mesmas mensagens devem ser reconhecidas como já processadas.

Use somente documentos fictícios ou de homologação no desenvolvimento. O projeto não inclui OCR: PDFs são identificados pelo contexto e pelo nome do arquivo.

## Execução futura em uma VPS

1. Instale Node.js 20+ e copie/clone o projeto.
2. Execute `npm ci --omit=dev`.
3. Transfira `.env`, `credentials.json` e `tokens/token.json` por um canal seguro; restrinja suas permissões no sistema operacional.
4. Garanta persistência e backup seguro para `data/` e `downloads/`.
5. Execute `npm start` com um gerenciador de processos como systemd ou PM2, configurando reinício automático.
6. Proteja a VPS, limite o acesso aos documentos e monitore espaço em disco e logs.

Se a autorização ainda não tiver sido feita, rode `npm run authorize` numa sessão interativa antes de iniciar o serviço. O cliente OAuth renova tokens expirados automaticamente quando existe um `refresh_token`; uma revogação exige nova autorização.

## Arquivos que nunca devem ir para o GitHub

O `.gitignore` protege:

- `.env`
- `credentials.json`
- `tokens/`
- `downloads/`
- `data/processed-emails.json`
- logs e `node_modules/`

Não faça commit de credenciais, tokens, notas fiscais reais ou dados pessoais. O arquivo local `data/processed-emails.json` começa como uma lista vazia e, por estar ignorado, suas mudanças não serão enviadas.

## Comandos úteis

```bash
npm run authorize  # cria/atualiza o token OAuth
npm start          # inicia o monitor
npm run dev        # inicia com reinício automático em alterações
npm run check      # verifica a sintaxe do ponto de entrada
```
