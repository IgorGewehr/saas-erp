export default function TermosPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-[#0B0F19] text-gray-800 dark:text-gray-200">
      <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Termos de Uso
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Última atualização: 30 de março de 2026
        </p>

        <p className="mb-6 leading-relaxed">
          Bem-vindo ao <strong>Aevo</strong>. Ao acessar ou usar nosso sistema de CRM Omnichannel,
          você concorda em cumprir estes Termos de Uso. Se não concordar com alguma parte destes termos, você não deve
          utilizar nossos serviços.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          1. Uso do Serviço e Integração com a Meta
        </h2>
        <p className="mb-3 leading-relaxed">
          Nosso sistema atua como um agregador de mensagens, utilizando as APIs oficiais fornecidas pela Meta Platforms,
          Inc. (Facebook, Instagram e WhatsApp).
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>
            Você é o único responsável por garantir que o uso do nosso sistema em sua operação esteja em conformidade
            com as Políticas do WhatsApp Commerce, Políticas da Plataforma do Messenger e Termos do Instagram.
          </li>
          <li>
            É terminantemente proibido utilizar nossa plataforma para enviar SPAM, mensagens não solicitadas, conteúdo
            abusivo, fraudulento ou que viole as leis locais.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          2. Responsabilidades da Conta
        </h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>
            Você é responsável por manter a confidencialidade de suas credenciais de acesso ao nosso sistema.
          </li>
          <li>
            Qualquer bloqueio ou banimento de suas contas do Facebook, Instagram ou WhatsApp pela própria Meta,
            decorrente de mau uso ou violação de políticas, é de sua inteira responsabilidade. O{' '}
            <strong>Aevo</strong> não tem poder para reverter decisões de moderação da Meta.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          3. Disponibilidade do Serviço
        </h2>
        <p className="mb-6 leading-relaxed">
          Trabalhamos para manter o sistema online 24/7, mas não garantimos que o serviço será ininterrupto ou livre de
          erros. Dependemos da estabilidade das APIs da Meta e de provedores de nuvem de terceiros. Interrupções
          causadas por instabilidades nos servidores do Facebook/WhatsApp isentam nossa plataforma de responsabilidade
          por atrasos no recebimento ou envio de mensagens.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          4. Propriedade Intelectual
        </h2>
        <p className="mb-6 leading-relaxed">
          Todo o código, design, interface e arquitetura do <strong>Aevo</strong> são de nossa
          propriedade exclusiva. O uso da plataforma não transfere a você nenhum direito de propriedade intelectual
          sobre o software.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          5. Cancelamento
        </h2>
        <p className="mb-6 leading-relaxed">
          Você pode cancelar o uso da plataforma a qualquer momento, desconectando seus canais e solicitando o
          encerramento da conta via suporte.
        </p>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-10 mb-3">
          6. Contato
        </h2>
        <p className="leading-relaxed">
          Para dúvidas ou problemas com os Termos de Uso, entre em contato:{' '}
          <strong>igor.gewehr1@gmail.com</strong>.
        </p>
      </div>
    </main>
  );
}
