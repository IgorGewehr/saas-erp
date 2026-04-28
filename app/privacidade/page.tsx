export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-white dark:bg-[#0B0F19] text-gray-800 dark:text-gray-200">
      <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Política de Privacidade
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Última atualização: 30 de março de 2026
        </p>

        <p className="mb-6 leading-relaxed">
          A sua privacidade é importante para nós. Esta Política de Privacidade explica como o{' '}
          <strong>Aevo</strong> (&quot;nós&quot;, &quot;nosso&quot;, &quot;sistema&quot;) coleta, usa,
          compartilha e protege as suas informações pessoais ao utilizar nossa plataforma de atendimento omnichannel e
          nossa integração com os serviços da Meta (Facebook, Instagram e WhatsApp).
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          1. Dados que Coletamos
        </h2>
        <p className="mb-3 leading-relaxed">
          Para fornecer nossos serviços de centralização de mensagens, coletamos as seguintes informações quando você
          conecta suas contas ou interage com nossa plataforma:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>
            <strong>Informações de Perfil da Meta:</strong> Nome, foto de perfil, ID de usuário do Facebook/Instagram
            (PSID/IGSID) e fuso horário, obtidos mediante sua autorização no login social.
          </li>
          <li>
            <strong>Conteúdo das Mensagens:</strong> Textos, áudios, imagens, vídeos e documentos trocados entre a sua
            página/conta comercial e seus clientes através da Graph API e Cloud API da Meta.
          </li>
          <li>
            <strong>Dados de Uso:</strong> Logs de acesso, endereço IP e interações dentro do nosso painel.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          2. Como Usamos Seus Dados
        </h2>
        <p className="mb-3 leading-relaxed">Utilizamos as informações coletadas estritamente para:</p>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li>
            Prestar o serviço de CRM, permitindo que você visualize e responda mensagens de múltiplos canais em uma
            única interface.
          </li>
          <li>
            Garantir o funcionamento técnico e a segurança da sincronização via Webhooks da Meta.
          </li>
          <li>Melhorar o desempenho da plataforma e oferecer suporte técnico.</li>
        </ul>
        <p className="mb-6 leading-relaxed">
          Nós <strong>não</strong> usamos os dados das suas conversas para treinar modelos de Inteligência Artificial de
          terceiros sem o seu consentimento explícito, nem vendemos seus dados para anunciantes.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          3. Compartilhamento de Dados
        </h2>
        <p className="mb-3 leading-relaxed">
          Não compartilhamos suas informações pessoais ou mensagens com terceiros, exceto:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>
            Com provedores de infraestrutura em nuvem estritamente necessários para hospedar o sistema (ex: AWS, Google
            Cloud, Firebase), que operam sob rigorosos acordos de confidencialidade.
          </li>
          <li>Para cumprir obrigações legais ou ordens judiciais.</li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          4. Retenção e Exclusão de Dados (Data Deletion)
        </h2>
        <p className="mb-3 leading-relaxed">
          Você tem controle total sobre os seus dados. Retemos suas informações apenas pelo tempo necessário para
          fornecer o serviço.
        </p>
        <p className="mb-3 leading-relaxed">
          <strong>Como solicitar a exclusão:</strong> Se você deseja revogar o acesso do nosso sistema à sua conta do
          Facebook/Instagram/WhatsApp ou solicitar a exclusão completa e permanente de todos os seus dados, mensagens e
          perfil do nosso banco de dados, envie um e-mail para{' '}
          <strong>igor.gewehr1@gmail.com</strong> com o assunto
          &quot;Exclusão de Dados&quot;.
        </p>
        <p className="mb-6 leading-relaxed">
          O processamento da exclusão será realizado em até 7 dias úteis, e confirmaremos a remoção total via e-mail.
          Você também pode remover nosso aplicativo diretamente pelas configurações de Integrações de Negócios no seu
          perfil do Facebook.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          5. Contato
        </h2>
        <p className="leading-relaxed">
          Se tiver dúvidas sobre esta Política de Privacidade, entre em contato conosco através do e-mail:{' '}
          <strong>igor.gewehr1@gmail.com</strong>.
        </p>
      </div>
    </main>
  );
}
