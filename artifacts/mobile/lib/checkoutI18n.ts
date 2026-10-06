/**
 * Buyer checkout in the store's language (seller Checkout settings →
 * "Checkout language", set on the Languages screen).
 *
 * Which language (resolveCheckoutLanguage):
 *  - a single-seller checkout uses that seller's store language
 *    (GET /api/checkout-profile → storeLanguage, default English);
 *  - a multi-seller cart has no one store language, so it uses the buyer's
 *    device language when it is one of the store languages below, else
 *    English.
 * The hosted Stripe page (guest checkout and the hosted fallback) gets the
 * same store language from the server (Stripe Checkout `locale`; Arabic is
 * not a Stripe Checkout locale, so Stripe follows the browser there).
 *
 * The tables are keyed by the English copy, so components wrap their
 * existing strings in t(); `{name}` placeholders are filled from `vars`.
 * Copy produced elsewhere in English (readiness hints, delivery windows,
 * decline messages) goes through the same t(): a template like
 * "Ships in {n} business days" also matches "Ships in 4 business days".
 * Anything not in the table renders in English.
 */

/** The Languages screen's store languages (app/languages.tsx). */
export const CHECKOUT_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'ja', 'ko', 'ar', 'it'] as const;
export type CheckoutLanguage = (typeof CHECKOUT_LANGUAGES)[number];
type Translated = Exclude<CheckoutLanguage, 'en'>;
export const TRANSLATED_LANGUAGES: Translated[] = ['es', 'fr', 'de', 'pt', 'zh', 'ja', 'ko', 'ar', 'it'];

export function isCheckoutLanguage(value: unknown): value is CheckoutLanguage {
  return typeof value === 'string' && (CHECKOUT_LANGUAGES as readonly string[]).includes(value);
}

/** "es-MX" → "es", "zh-Hans-CN" → "zh"; null when not a store language. */
export function languageFromLocale(locale: string | null | undefined): CheckoutLanguage | null {
  const code = (locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return isCheckoutLanguage(code) ? code : null;
}

/** The device's language (Intl in Hermes and browsers). */
export function deviceLocale(): string | null {
  try {
    const nav = (globalThis as { navigator?: { language?: string } }).navigator;
    return nav?.language || Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

export function resolveCheckoutLanguage(input: {
  /** One entry per seller in the checkout: their store language (undefined while unknown). */
  sellerLanguages: Array<string | null | undefined>;
  deviceLocale: string | null | undefined;
}): CheckoutLanguage {
  if (input.sellerLanguages.length === 1) {
    const store = input.sellerLanguages[0];
    return isCheckoutLanguage(store) ? store : 'en';
  }
  return languageFromLocale(input.deviceLocale) ?? 'en';
}

type Row = readonly [string, Record<Translated, string>];

const ROWS: Row[] = [
  // ── Page ────────────────────────────────────────────────────────────────
  ['Checkout', { es: 'Pago', fr: 'Paiement', de: 'Kasse', pt: 'Finalizar compra', zh: '结账', ja: 'ご購入手続き', ko: '결제', ar: 'الدفع', it: 'Pagamento' }],
  ['Close checkout', { es: 'Cerrar el pago', fr: 'Fermer le paiement', de: 'Kasse schließen', pt: 'Fechar finalização', zh: '关闭结账', ja: '購入手続きを閉じる', ko: '결제 닫기', ar: 'إغلاق الدفع', it: 'Chiudi pagamento' }],
  ['Order confirmation', { es: 'Confirmación del pedido', fr: 'Confirmation de commande', de: 'Bestellbestätigung', pt: 'Confirmação do pedido', zh: '订单确认', ja: '注文確認', ko: '주문 확인', ar: 'تأكيد الطلب', it: 'Conferma dell’ordine' }],
  ['Close', { es: 'Cerrar', fr: 'Fermer', de: 'Schließen', pt: 'Fechar', zh: '关闭', ja: '閉じる', ko: '닫기', ar: 'إغلاق', it: 'Chiudi' }],
  ["We couldn't load checkout. Check your connection and try again.", { es: 'No pudimos cargar el pago. Revisa tu conexión e inténtalo de nuevo.', fr: 'Impossible de charger le paiement. Vérifiez votre connexion et réessayez.', de: 'Die Kasse konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.', pt: 'Não foi possível carregar a finalização. Verifique sua conexão e tente novamente.', zh: '无法加载结账页面。请检查网络连接后重试。', ja: '購入手続きを読み込めませんでした。接続を確認してもう一度お試しください。', ko: '결제를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.', ar: 'تعذّر تحميل صفحة الدفع. تحقّق من اتصالك وحاول مرة أخرى.', it: 'Impossibile caricare il pagamento. Controlla la connessione e riprova.' }],
  ['Try again', { es: 'Reintentar', fr: 'Réessayer', de: 'Erneut versuchen', pt: 'Tentar novamente', zh: '重试', ja: '再試行', ko: '다시 시도', ar: 'حاول مرة أخرى', it: 'Riprova' }],
  ['Pay {amount}', { es: 'Pagar {amount}', fr: 'Payer {amount}', de: '{amount} bezahlen', pt: 'Pagar {amount}', zh: '支付 {amount}', ja: '{amount}を支払う', ko: '{amount} 결제', ar: 'ادفع {amount}', it: 'Paga {amount}' }],
  ['Try again · {amount}', { es: 'Reintentar · {amount}', fr: 'Réessayer · {amount}', de: 'Erneut versuchen · {amount}', pt: 'Tentar novamente · {amount}', zh: '重试 · {amount}', ja: '再試行 · {amount}', ko: '다시 시도 · {amount}', ar: 'حاول مرة أخرى · {amount}', it: 'Riprova · {amount}' }],
  ['Dismiss', { es: 'Descartar', fr: 'Ignorer', de: 'Ausblenden', pt: 'Dispensar', zh: '关闭', ja: '閉じる', ko: '닫기', ar: 'تجاهل', it: 'Ignora' }],
  ['Enter your card details to continue', { es: 'Introduce los datos de tu tarjeta para continuar', fr: 'Saisissez les informations de votre carte pour continuer', de: 'Gib deine Kartendaten ein, um fortzufahren', pt: 'Insira os dados do cartão para continuar', zh: '请输入银行卡信息以继续', ja: '続行するにはカード情報を入力してください', ko: '계속하려면 카드 정보를 입력하세요', ar: 'أدخل بيانات بطاقتك للمتابعة', it: 'Inserisci i dati della carta per continuare' }],
  ['Pre-order terms', { es: 'Condiciones de preventa', fr: 'Conditions de précommande', de: 'Vorbestellungsbedingungen', pt: 'Termos de pré-venda', zh: '预购条款', ja: '予約注文の条件', ko: '예약 주문 약관', ar: 'شروط الطلب المسبق', it: 'Condizioni di preordine' }],
  ['Added with your address', { es: 'Se añade con tu dirección', fr: 'Ajoutée avec votre adresse', de: 'Wird mit deiner Adresse berechnet', pt: 'Adicionado com seu endereço', zh: '填写地址后计算', ja: '住所の入力後に加算', ko: '주소 입력 후 추가', ar: 'تُضاف مع عنوانك', it: 'Aggiunta con il tuo indirizzo' }],
  ['Calculated at payment', { es: 'Se calcula al pagar', fr: 'Calculée au paiement', de: 'Wird beim Bezahlen berechnet', pt: 'Calculado no pagamento', zh: '付款时计算', ja: 'お支払い時に計算', ko: '결제 시 계산', ar: 'تُحسب عند الدفع', it: 'Calcolata al pagamento' }],
  ['Promo codes apply to single-seller orders. Check out each seller separately to use a code.', { es: 'Los códigos promocionales se aplican a pedidos de un solo vendedor. Paga a cada vendedor por separado para usar un código.', fr: 'Les codes promo s’appliquent aux commandes d’un seul vendeur. Payez chaque vendeur séparément pour utiliser un code.', de: 'Aktionscodes gelten für Bestellungen bei einem Verkäufer. Bezahle jeden Verkäufer einzeln, um einen Code zu nutzen.', pt: 'Códigos promocionais valem para pedidos de um só vendedor. Finalize cada vendedor separadamente para usar um código.', zh: '优惠码仅适用于单一卖家的订单。请分别为每位卖家结账以使用优惠码。', ja: 'プロモーションコードは1つのショップの注文にのみ使えます。コードを使うにはショップごとに購入手続きをしてください。', ko: '프로모션 코드는 판매자 한 곳의 주문에만 적용됩니다. 코드를 사용하려면 판매자별로 따로 결제하세요.', ar: 'تنطبق رموز الخصم على طلبات بائع واحد. ادفع لكل بائع على حدة لاستخدام رمز.', it: 'I codici promozionali valgono per ordini di un solo venditore. Paga ogni venditore separatamente per usare un codice.' }],

  // ── Errors on the page ──────────────────────────────────────────────────
  ['Some items in your order changed', { es: 'Algunos artículos de tu pedido cambiaron', fr: 'Certains articles de votre commande ont changé', de: 'Einige Artikel deiner Bestellung haben sich geändert', pt: 'Alguns itens do seu pedido mudaram', zh: '您订单中的部分商品有变动', ja: 'ご注文の一部の商品が変更されました', ko: '주문의 일부 상품이 변경되었습니다', ar: 'تغيّرت بعض المنتجات في طلبك', it: 'Alcuni articoli del tuo ordine sono cambiati' }],
  ['Review your cart and try again.', { es: 'Revisa tu carrito e inténtalo de nuevo.', fr: 'Vérifiez votre panier et réessayez.', de: 'Prüfe deinen Warenkorb und versuche es erneut.', pt: 'Revise seu carrinho e tente novamente.', zh: '请检查购物袋后重试。', ja: 'カートを確認してもう一度お試しください。', ko: '장바구니를 확인하고 다시 시도하세요.', ar: 'راجع سلتك وحاول مرة أخرى.', it: 'Controlla il carrello e riprova.' }],
  ['Unable to verify your order', { es: 'No se pudo verificar tu pedido', fr: 'Impossible de vérifier votre commande', de: 'Deine Bestellung konnte nicht geprüft werden', pt: 'Não foi possível verificar seu pedido', zh: '无法验证您的订单', ja: 'ご注文を確認できませんでした', ko: '주문을 확인할 수 없습니다', ar: 'تعذّر التحقق من طلبك', it: 'Impossibile verificare l’ordine' }],
  ['We could not confirm current prices and availability. Check your connection and try again.', { es: 'No pudimos confirmar los precios ni la disponibilidad. Revisa tu conexión e inténtalo de nuevo.', fr: 'Impossible de confirmer les prix et la disponibilité. Vérifiez votre connexion et réessayez.', de: 'Preise und Verfügbarkeit konnten nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.', pt: 'Não foi possível confirmar preços e disponibilidade. Verifique sua conexão e tente novamente.', zh: '无法确认当前价格和库存。请检查网络连接后重试。', ja: '現在の価格と在庫を確認できませんでした。接続を確認してもう一度お試しください。', ko: '현재 가격과 재고를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.', ar: 'تعذّر تأكيد الأسعار والتوفر الحاليين. تحقّق من اتصالك وحاول مرة أخرى.', it: 'Impossibile confermare prezzi e disponibilità. Controlla la connessione e riprova.' }],
  ['One more step', { es: 'Un paso más', fr: 'Encore une étape', de: 'Noch ein Schritt', pt: 'Só mais um passo', zh: '还差一步', ja: 'あと1ステップ', ko: '한 단계만 더', ar: 'خطوة أخرى', it: 'Ancora un passaggio' }],
  ['This order is paid on Stripe’s secure page. Tap Pay again to continue. You haven’t been charged.', { es: 'Este pedido se paga en la página segura de Stripe. Toca Pagar de nuevo para continuar. No se te ha cobrado.', fr: 'Cette commande se paie sur la page sécurisée de Stripe. Touchez Payer à nouveau pour continuer. Vous n’avez pas été débité.', de: 'Diese Bestellung wird auf der sicheren Stripe-Seite bezahlt. Tippe erneut auf Bezahlen. Dir wurde nichts berechnet.', pt: 'Este pedido é pago na página segura da Stripe. Toque em Pagar de novo para continuar. Você não foi cobrado.', zh: '此订单需在 Stripe 安全页面付款。再次点击支付以继续。您尚未被扣款。', ja: 'この注文はStripeの安全なページでお支払いいただきます。もう一度「支払う」をタップしてください。請求はまだ発生していません。', ko: '이 주문은 Stripe 보안 페이지에서 결제됩니다. 계속하려면 결제를 다시 누르세요. 아직 청구되지 않았습니다.', ar: 'يُدفع هذا الطلب في صفحة Stripe الآمنة. اضغط على ادفع مرة أخرى للمتابعة. لم يتم خصم أي مبلغ.', it: 'Questo ordine si paga sulla pagina sicura di Stripe. Tocca di nuovo Paga per continuare. Non ti è stato addebitato nulla.' }],
  ['Payment closed', { es: 'Pago cerrado', fr: 'Paiement fermé', de: 'Zahlung geschlossen', pt: 'Pagamento encerrado', zh: '付款已关闭', ja: 'お支払いが終了しました', ko: '결제가 종료됨', ar: 'أُغلق الدفع', it: 'Pagamento chiuso' }],
  ['That payment attempt timed out. Tap Pay again to start a new one. You haven’t been charged.', { es: 'Ese intento de pago caducó. Toca Pagar de nuevo para empezar otro. No se te ha cobrado.', fr: 'Cette tentative de paiement a expiré. Touchez Payer pour en lancer une nouvelle. Vous n’avez pas été débité.', de: 'Dieser Zahlungsversuch ist abgelaufen. Tippe erneut auf Bezahlen. Dir wurde nichts berechnet.', pt: 'Essa tentativa de pagamento expirou. Toque em Pagar para começar outra. Você não foi cobrado.', zh: '此次付款已超时。再次点击支付以重新开始。您尚未被扣款。', ja: 'お支払いの試行がタイムアウトしました。もう一度「支払う」をタップしてください。請求はまだ発生していません。', ko: '결제 시도 시간이 초과되었습니다. 결제를 다시 눌러 새로 시작하세요. 아직 청구되지 않았습니다.', ar: 'انتهت مهلة محاولة الدفع. اضغط على ادفع لبدء محاولة جديدة. لم يتم خصم أي مبلغ.', it: 'Il tentativo di pagamento è scaduto. Tocca Paga per riprovare. Non ti è stato addebitato nulla.' }],
  ['We couldn’t start your payment', { es: 'No pudimos iniciar tu pago', fr: 'Impossible de lancer votre paiement', de: 'Deine Zahlung konnte nicht gestartet werden', pt: 'Não foi possível iniciar seu pagamento', zh: '无法开始付款', ja: 'お支払いを開始できませんでした', ko: '결제를 시작하지 못했습니다', ar: 'تعذّر بدء الدفع', it: 'Impossibile avviare il pagamento' }],
  ['Something went wrong reaching our payment service. Check your connection and try again. You haven’t been charged.', { es: 'Algo falló al conectar con nuestro servicio de pagos. Revisa tu conexión e inténtalo de nuevo. No se te ha cobrado.', fr: 'Un problème est survenu avec notre service de paiement. Vérifiez votre connexion et réessayez. Vous n’avez pas été débité.', de: 'Unser Zahlungsdienst war nicht erreichbar. Prüfe deine Verbindung und versuche es erneut. Dir wurde nichts berechnet.', pt: 'Algo deu errado ao acessar nosso serviço de pagamento. Verifique sua conexão e tente novamente. Você não foi cobrado.', zh: '连接付款服务时出错。请检查网络连接后重试。您尚未被扣款。', ja: '決済サービスへの接続中に問題が発生しました。接続を確認してもう一度お試しください。請求はまだ発生していません。', ko: '결제 서비스 연결 중 문제가 발생했습니다. 연결을 확인하고 다시 시도하세요. 아직 청구되지 않았습니다.', ar: 'حدث خطأ أثناء الاتصال بخدمة الدفع. تحقّق من اتصالك وحاول مرة أخرى. لم يتم خصم أي مبلغ.', it: 'Si è verificato un problema con il servizio di pagamento. Controlla la connessione e riprova. Non ti è stato addebitato nulla.' }],
  ['Payment declined', { es: 'Pago rechazado', fr: 'Paiement refusé', de: 'Zahlung abgelehnt', pt: 'Pagamento recusado', zh: '付款被拒', ja: 'お支払いが拒否されました', ko: '결제 거절됨', ar: 'رُفض الدفع', it: 'Pagamento rifiutato' }],
  ['Payment cancelled', { es: 'Pago cancelado', fr: 'Paiement annulé', de: 'Zahlung abgebrochen', pt: 'Pagamento cancelado', zh: '付款已取消', ja: 'お支払いがキャンセルされました', ko: '결제 취소됨', ar: 'أُلغي الدفع', it: 'Pagamento annullato' }],
  ['You weren’t charged. Your order is still here whenever you’re ready.', { es: 'No se te cobró. Tu pedido sigue aquí cuando quieras.', fr: 'Vous n’avez pas été débité. Votre commande vous attend.', de: 'Dir wurde nichts berechnet. Deine Bestellung wartet hier auf dich.', pt: 'Você não foi cobrado. Seu pedido continua aqui quando quiser.', zh: '您未被扣款。订单会一直保留，随时可以继续。', ja: '請求は発生していません。ご注文はそのまま残っています。', ko: '청구되지 않았습니다. 주문은 그대로 남아 있습니다.', ar: 'لم يتم خصم أي مبلغ. طلبك محفوظ هنا متى كنت جاهزًا.', it: 'Non ti è stato addebitato nulla. Il tuo ordine resta qui quando vuoi.' }],
  ['You closed secure checkout before paying. Your order is still saved — place it again whenever you’re ready.', { es: 'Cerraste el pago seguro antes de pagar. Tu pedido sigue guardado: hazlo de nuevo cuando quieras.', fr: 'Vous avez fermé le paiement sécurisé avant de payer. Votre commande est enregistrée : passez-la quand vous voulez.', de: 'Du hast die sichere Kasse vor dem Bezahlen geschlossen. Deine Bestellung ist gespeichert – gib sie auf, wann du willst.', pt: 'Você fechou a finalização segura antes de pagar. Seu pedido continua salvo — faça-o de novo quando quiser.', zh: '您在付款前关闭了安全结账。订单已保存，随时可以重新下单。', ja: 'お支払い前に安全な購入手続きを閉じました。ご注文は保存されています。いつでも再度ご注文ください。', ko: '결제 전에 보안 결제를 닫았습니다. 주문은 저장되어 있으니 언제든 다시 주문하세요.', ar: 'أغلقت صفحة الدفع الآمن قبل الدفع. طلبك محفوظ — أعد تقديمه متى شئت.', it: 'Hai chiuso il pagamento sicuro prima di pagare. L’ordine è salvato: inoltralo quando vuoi.' }],
  ['Payment not confirmed yet', { es: 'Pago aún no confirmado', fr: 'Paiement pas encore confirmé', de: 'Zahlung noch nicht bestätigt', pt: 'Pagamento ainda não confirmado', zh: '付款尚未确认', ja: 'お支払いはまだ確認されていません', ko: '아직 결제가 확인되지 않았습니다', ar: 'لم يُؤكَّد الدفع بعد', it: 'Pagamento non ancora confermato' }],
  ['We’re still confirming your payment. This can take a minute — check your order status shortly.', { es: 'Aún estamos confirmando tu pago. Puede tardar un minuto: revisa el estado de tu pedido en breve.', fr: 'Nous confirmons encore votre paiement. Cela peut prendre une minute : vérifiez bientôt le statut de votre commande.', de: 'Wir bestätigen deine Zahlung noch. Das kann eine Minute dauern – prüfe gleich den Bestellstatus.', pt: 'Ainda estamos confirmando seu pagamento. Pode levar um minuto — confira o status do pedido em breve.', zh: '我们仍在确认您的付款，可能需要一分钟，请稍后查看订单状态。', ja: 'お支払いを確認中です。1分ほどかかる場合があります。しばらくしてから注文状況をご確認ください。', ko: '결제를 확인하고 있습니다. 1분 정도 걸릴 수 있으니 잠시 후 주문 상태를 확인하세요.', ar: 'ما زلنا نؤكد دفعتك. قد يستغرق ذلك دقيقة — تحقّق من حالة طلبك بعد قليل.', it: 'Stiamo ancora confermando il pagamento. Può richiedere un minuto: controlla tra poco lo stato dell’ordine.' }],
  ['Sign in to check out', { es: 'Inicia sesión para pagar', fr: 'Connectez-vous pour payer', de: 'Melde dich zum Bezahlen an', pt: 'Entre para finalizar a compra', zh: '登录后结账', ja: 'サインインして購入', ko: '로그인 후 결제', ar: 'سجّل الدخول لإتمام الشراء', it: 'Accedi per pagare' }],
  ['Couldn’t start secure checkout', { es: 'No se pudo iniciar el pago seguro', fr: 'Impossible de lancer le paiement sécurisé', de: 'Die sichere Kasse konnte nicht gestartet werden', pt: 'Não foi possível iniciar a finalização segura', zh: '无法启动安全结账', ja: '安全な購入手続きを開始できませんでした', ko: '보안 결제를 시작하지 못했습니다', ar: 'تعذّر بدء الدفع الآمن', it: 'Impossibile avviare il pagamento sicuro' }],
  ['Something went wrong reaching Stripe. Check your connection and try again — you haven’t been charged.', { es: 'Algo falló al conectar con Stripe. Revisa tu conexión e inténtalo de nuevo: no se te ha cobrado.', fr: 'Un problème est survenu avec Stripe. Vérifiez votre connexion et réessayez : vous n’avez pas été débité.', de: 'Stripe war nicht erreichbar. Prüfe deine Verbindung und versuche es erneut – dir wurde nichts berechnet.', pt: 'Algo deu errado ao acessar a Stripe. Verifique sua conexão e tente novamente — você não foi cobrado.', zh: '连接 Stripe 时出错。请检查网络连接后重试，您尚未被扣款。', ja: 'Stripeへの接続中に問題が発生しました。接続を確認してもう一度お試しください。請求はまだ発生していません。', ko: 'Stripe 연결 중 문제가 발생했습니다. 연결을 확인하고 다시 시도하세요. 아직 청구되지 않았습니다.', ar: 'حدث خطأ أثناء الاتصال بـ Stripe. تحقّق من اتصالك وحاول مرة أخرى — لم يتم خصم أي مبلغ.', it: 'Si è verificato un problema con Stripe. Controlla la connessione e riprova: non ti è stato addebitato nulla.' }],
  ['This shop asks buyers to sign in to check out. Sign in or create an account to continue.', { es: 'Esta tienda pide iniciar sesión para pagar. Inicia sesión o crea una cuenta para continuar.', fr: 'Cette boutique demande de se connecter pour payer. Connectez-vous ou créez un compte pour continuer.', de: 'Dieser Shop verlangt eine Anmeldung zum Bezahlen. Melde dich an oder erstelle ein Konto.', pt: 'Esta loja pede que você entre para finalizar a compra. Entre ou crie uma conta para continuar.', zh: '该店铺要求登录后结账。请登录或创建账户以继续。', ja: 'このショップではサインインが必要です。サインインまたはアカウントを作成して続行してください。', ko: '이 상점은 로그인 후 결제할 수 있습니다. 로그인하거나 계정을 만들어 계속하세요.', ar: 'يطلب هذا المتجر تسجيل الدخول لإتمام الشراء. سجّل الدخول أو أنشئ حسابًا للمتابعة.', it: 'Questo negozio richiede l’accesso per pagare. Accedi o crea un account per continuare.' }],

  // ── Decline messages (lib/checkoutPayment.ts paymentErrorMessage) ───────
  ['Your card was declined. Try another card or contact your bank.', { es: 'Tu tarjeta fue rechazada. Prueba otra tarjeta o contacta con tu banco.', fr: 'Votre carte a été refusée. Essayez une autre carte ou contactez votre banque.', de: 'Deine Karte wurde abgelehnt. Versuche eine andere Karte oder wende dich an deine Bank.', pt: 'Seu cartão foi recusado. Tente outro cartão ou fale com seu banco.', zh: '您的银行卡被拒绝。请换一张卡或联系您的银行。', ja: 'カードが拒否されました。別のカードをお試しいただくか、カード会社にお問い合わせください。', ko: '카드가 거절되었습니다. 다른 카드를 사용하거나 은행에 문의하세요.', ar: 'رُفضت بطاقتك. جرّب بطاقة أخرى أو تواصل مع مصرفك.', it: 'La carta è stata rifiutata. Prova un’altra carta o contatta la banca.' }],
  ['Your card was declined for insufficient funds. Try another card.', { es: 'Tu tarjeta fue rechazada por fondos insuficientes. Prueba otra tarjeta.', fr: 'Votre carte a été refusée pour provision insuffisante. Essayez une autre carte.', de: 'Deine Karte wurde wegen fehlender Deckung abgelehnt. Versuche eine andere Karte.', pt: 'Seu cartão foi recusado por saldo insuficiente. Tente outro cartão.', zh: '余额不足，您的银行卡被拒绝。请换一张卡。', ja: '残高不足のためカードが拒否されました。別のカードをお試しください。', ko: '잔액 부족으로 카드가 거절되었습니다. 다른 카드를 사용하세요.', ar: 'رُفضت بطاقتك لعدم كفاية الرصيد. جرّب بطاقة أخرى.', it: 'La carta è stata rifiutata per fondi insufficienti. Prova un’altra carta.' }],
  ['That card has expired. Try another card.', { es: 'Esa tarjeta ha caducado. Prueba otra.', fr: 'Cette carte a expiré. Essayez-en une autre.', de: 'Diese Karte ist abgelaufen. Versuche eine andere.', pt: 'Esse cartão expirou. Tente outro.', zh: '该银行卡已过期。请换一张卡。', ja: 'このカードは有効期限が切れています。別のカードをお試しください。', ko: '만료된 카드입니다. 다른 카드를 사용하세요.', ar: 'انتهت صلاحية هذه البطاقة. جرّب بطاقة أخرى.', it: 'La carta è scaduta. Prova un’altra carta.' }],
  ['The security code didn’t match. Check it and try again.', { es: 'El código de seguridad no coincide. Revísalo e inténtalo de nuevo.', fr: 'Le code de sécurité ne correspond pas. Vérifiez-le et réessayez.', de: 'Der Sicherheitscode stimmt nicht. Prüfe ihn und versuche es erneut.', pt: 'O código de segurança não confere. Confira e tente novamente.', zh: '安全码不匹配。请检查后重试。', ja: 'セキュリティコードが一致しません。確認してもう一度お試しください。', ko: '보안 코드가 일치하지 않습니다. 확인 후 다시 시도하세요.', ar: 'رمز الأمان غير مطابق. تحقّق منه وحاول مرة أخرى.', it: 'Il codice di sicurezza non corrisponde. Controllalo e riprova.' }],
  ['Something went wrong processing your card. Try again.', { es: 'Algo falló al procesar tu tarjeta. Inténtalo de nuevo.', fr: 'Un problème est survenu lors du traitement de votre carte. Réessayez.', de: 'Bei der Verarbeitung deiner Karte ist ein Fehler aufgetreten. Versuche es erneut.', pt: 'Algo deu errado ao processar seu cartão. Tente novamente.', zh: '处理您的银行卡时出错。请重试。', ja: 'カードの処理中に問題が発生しました。もう一度お試しください。', ko: '카드 처리 중 문제가 발생했습니다. 다시 시도하세요.', ar: 'حدث خطأ أثناء معالجة بطاقتك. حاول مرة أخرى.', it: 'Si è verificato un problema con la carta. Riprova.' }],
  ['That card number looks incorrect. Check it and try again.', { es: 'Ese número de tarjeta parece incorrecto. Revísalo e inténtalo de nuevo.', fr: 'Ce numéro de carte semble incorrect. Vérifiez-le et réessayez.', de: 'Diese Kartennummer scheint falsch zu sein. Prüfe sie und versuche es erneut.', pt: 'Esse número de cartão parece incorreto. Confira e tente novamente.', zh: '银行卡号似乎有误。请检查后重试。', ja: 'カード番号が正しくないようです。確認してもう一度お試しください。', ko: '카드 번호가 올바르지 않습니다. 확인 후 다시 시도하세요.', ar: 'يبدو أن رقم البطاقة غير صحيح. تحقّق منه وحاول مرة أخرى.', it: 'Il numero della carta non sembra corretto. Controllalo e riprova.' }],
  ['Your bank needs to confirm this payment. Try again and complete the check.', { es: 'Tu banco necesita confirmar este pago. Inténtalo de nuevo y completa la verificación.', fr: 'Votre banque doit confirmer ce paiement. Réessayez et terminez la vérification.', de: 'Deine Bank muss diese Zahlung bestätigen. Versuche es erneut und schließe die Prüfung ab.', pt: 'Seu banco precisa confirmar este pagamento. Tente novamente e conclua a verificação.', zh: '您的银行需要确认此付款。请重试并完成验证。', ja: 'カード会社によるお支払いの確認が必要です。もう一度お試しいただき、認証を完了してください。', ko: '은행에서 이 결제를 확인해야 합니다. 다시 시도하여 인증을 완료하세요.', ar: 'يحتاج مصرفك إلى تأكيد هذه الدفعة. حاول مرة أخرى وأكمل التحقق.', it: 'La banca deve confermare il pagamento. Riprova e completa la verifica.' }],
  ['Your bank couldn’t confirm this payment. Try again or use another card.', { es: 'Tu banco no pudo confirmar este pago. Inténtalo de nuevo o usa otra tarjeta.', fr: 'Votre banque n’a pas pu confirmer ce paiement. Réessayez ou utilisez une autre carte.', de: 'Deine Bank konnte diese Zahlung nicht bestätigen. Versuche es erneut oder nutze eine andere Karte.', pt: 'Seu banco não conseguiu confirmar este pagamento. Tente novamente ou use outro cartão.', zh: '您的银行无法确认此付款。请重试或换一张卡。', ja: 'カード会社がお支払いを確認できませんでした。もう一度お試しいただくか、別のカードをご利用ください。', ko: '은행에서 결제를 확인하지 못했습니다. 다시 시도하거나 다른 카드를 사용하세요.', ar: 'تعذّر على مصرفك تأكيد هذه الدفعة. حاول مرة أخرى أو استخدم بطاقة أخرى.', it: 'La banca non ha potuto confermare il pagamento. Riprova o usa un’altra carta.' }],
  ['Your payment didn’t go through. Try again or use another card.', { es: 'Tu pago no se completó. Inténtalo de nuevo o usa otra tarjeta.', fr: 'Votre paiement n’a pas abouti. Réessayez ou utilisez une autre carte.', de: 'Deine Zahlung ist nicht durchgegangen. Versuche es erneut oder nutze eine andere Karte.', pt: 'Seu pagamento não foi concluído. Tente novamente ou use outro cartão.', zh: '付款未成功。请重试或换一张卡。', ja: 'お支払いが完了しませんでした。もう一度お試しいただくか、別のカードをご利用ください。', ko: '결제가 완료되지 않았습니다. 다시 시도하거나 다른 카드를 사용하세요.', ar: 'لم تتم عملية الدفع. حاول مرة أخرى أو استخدم بطاقة أخرى.', it: 'Il pagamento non è andato a buon fine. Riprova o usa un’altra carta.' }],

  // ── Readiness hints and field errors (lib/checkoutReadiness.ts) ────────
  ['Enter a valid email to continue', { es: 'Introduce un correo válido para continuar', fr: 'Saisissez une adresse e-mail valide pour continuer', de: 'Gib eine gültige E-Mail-Adresse ein, um fortzufahren', pt: 'Insira um e-mail válido para continuar', zh: '请输入有效的邮箱以继续', ja: '続行するには有効なメールアドレスを入力してください', ko: '계속하려면 올바른 이메일을 입력하세요', ar: 'أدخل بريدًا إلكترونيًا صالحًا للمتابعة', it: 'Inserisci un’email valida per continuare' }],
  ['Enter a phone number for delivery updates', { es: 'Introduce un teléfono para recibir avisos de entrega', fr: 'Saisissez un numéro pour le suivi de livraison', de: 'Gib eine Telefonnummer für Lieferupdates ein', pt: 'Insira um telefone para atualizações de entrega', zh: '请输入用于配送通知的手机号', ja: '配送のお知らせ用の電話番号を入力してください', ko: '배송 알림을 받을 전화번호를 입력하세요', ar: 'أدخل رقم هاتف لتحديثات التوصيل', it: 'Inserisci un numero di telefono per gli aggiornamenti di consegna' }],
  ['Add a shipping address to continue', { es: 'Añade una dirección de envío para continuar', fr: 'Ajoutez une adresse de livraison pour continuer', de: 'Füge eine Lieferadresse hinzu, um fortzufahren', pt: 'Adicione um endereço de entrega para continuar', zh: '请添加收货地址以继续', ja: '続行するには配送先住所を追加してください', ko: '계속하려면 배송 주소를 추가하세요', ar: 'أضف عنوان شحن للمتابعة', it: 'Aggiungi un indirizzo di spedizione per continuare' }],
  ['Choose a delivery option to continue', { es: 'Elige una opción de entrega para continuar', fr: 'Choisissez un mode de livraison pour continuer', de: 'Wähle eine Versandoption, um fortzufahren', pt: 'Escolha uma opção de entrega para continuar', zh: '请选择配送方式以继续', ja: '続行するには配送方法を選択してください', ko: '계속하려면 배송 옵션을 선택하세요', ar: 'اختر خيار توصيل للمتابعة', it: 'Scegli un’opzione di consegna per continuare' }],
  ['Accept the pre-order terms to continue', { es: 'Acepta las condiciones de preventa para continuar', fr: 'Acceptez les conditions de précommande pour continuer', de: 'Akzeptiere die Vorbestellungsbedingungen, um fortzufahren', pt: 'Aceite os termos de pré-venda para continuar', zh: '请接受预购条款以继续', ja: '続行するには予約注文の条件に同意してください', ko: '계속하려면 예약 주문 약관에 동의하세요', ar: 'وافق على شروط الطلب المسبق للمتابعة', it: 'Accetta le condizioni di preordine per continuare' }],
  ['Enter your email address', { es: 'Introduce tu correo electrónico', fr: 'Saisissez votre adresse e-mail', de: 'Gib deine E-Mail-Adresse ein', pt: 'Insira seu e-mail', zh: '请输入邮箱地址', ja: 'メールアドレスを入力してください', ko: '이메일 주소를 입력하세요', ar: 'أدخل بريدك الإلكتروني', it: 'Inserisci il tuo indirizzo email' }],
  ['Enter a valid email, like name@example.com', { es: 'Introduce un correo válido, como nombre@ejemplo.com', fr: 'Saisissez une adresse valide, comme nom@exemple.com', de: 'Gib eine gültige E-Mail ein, z. B. name@beispiel.de', pt: 'Insira um e-mail válido, como nome@exemplo.com', zh: '请输入有效邮箱，例如 name@example.com', ja: 'name@example.com のような有効なメールアドレスを入力してください', ko: 'name@example.com 형식의 올바른 이메일을 입력하세요', ar: 'أدخل بريدًا صالحًا مثل name@example.com', it: 'Inserisci un’email valida, ad esempio nome@esempio.com' }],
  ['Enter a valid phone number', { es: 'Introduce un teléfono válido', fr: 'Saisissez un numéro valide', de: 'Gib eine gültige Telefonnummer ein', pt: 'Insira um telefone válido', zh: '请输入有效的手机号', ja: '有効な電話番号を入力してください', ko: '올바른 전화번호를 입력하세요', ar: 'أدخل رقم هاتف صالحًا', it: 'Inserisci un numero di telefono valido' }],
  ['Enter the recipient’s full name', { es: 'Introduce el nombre completo del destinatario', fr: 'Saisissez le nom complet du destinataire', de: 'Gib den vollständigen Namen des Empfängers ein', pt: 'Insira o nome completo do destinatário', zh: '请输入收件人全名', ja: '受取人の氏名を入力してください', ko: '받는 사람의 전체 이름을 입력하세요', ar: 'أدخل الاسم الكامل للمستلم', it: 'Inserisci il nome completo del destinatario' }],
  ['Enter a street address', { es: 'Introduce una dirección', fr: 'Saisissez une adresse', de: 'Gib eine Straße und Hausnummer ein', pt: 'Insira um endereço', zh: '请输入街道地址', ja: '番地を入力してください', ko: '도로명 주소를 입력하세요', ar: 'أدخل عنوان الشارع', it: 'Inserisci un indirizzo' }],
  ['Required', { es: 'Obligatorio', fr: 'Obligatoire', de: 'Erforderlich', pt: 'Obrigatório', zh: '必填', ja: '必須', ko: '필수', ar: 'مطلوب', it: 'Obbligatorio' }],
  ['Enter a valid code', { es: 'Introduce un código válido', fr: 'Saisissez un code valide', de: 'Gib eine gültige Postleitzahl ein', pt: 'Insira um código válido', zh: '请输入有效的邮编', ja: '有効な郵便番号を入力してください', ko: '올바른 우편번호를 입력하세요', ar: 'أدخل رمزًا صالحًا', it: 'Inserisci un codice valido' }],

  // ── Contact ──────────────────────────────────────────────────────────────
  ['Contact', { es: 'Contacto', fr: 'Contact', de: 'Kontakt', pt: 'Contato', zh: '联系方式', ja: '連絡先', ko: '연락처', ar: 'التواصل', it: 'Contatti' }],
  ['Email', { es: 'Correo electrónico', fr: 'E-mail', de: 'E-Mail', pt: 'E-mail', zh: '邮箱', ja: 'メールアドレス', ko: '이메일', ar: 'البريد الإلكتروني', it: 'Email' }],
  ['Phone', { es: 'Teléfono', fr: 'Téléphone', de: 'Telefon', pt: 'Telefone', zh: '电话', ja: '電話番号', ko: '전화번호', ar: 'الهاتف', it: 'Telefono' }],
  ['For delivery updates only', { es: 'Solo para avisos de entrega', fr: 'Uniquement pour le suivi de livraison', de: 'Nur für Lieferupdates', pt: 'Apenas para atualizações de entrega', zh: '仅用于配送通知', ja: '配送のお知らせにのみ使用します', ko: '배송 알림에만 사용됩니다', ar: 'لتحديثات التوصيل فقط', it: 'Solo per gli aggiornamenti di consegna' }],

  // ── Shipping ─────────────────────────────────────────────────────────────
  ['Shipping address', { es: 'Dirección de envío', fr: 'Adresse de livraison', de: 'Lieferadresse', pt: 'Endereço de entrega', zh: '收货地址', ja: '配送先住所', ko: '배송 주소', ar: 'عنوان الشحن', it: 'Indirizzo di spedizione' }],
  ['Full name', { es: 'Nombre completo', fr: 'Nom complet', de: 'Vollständiger Name', pt: 'Nome completo', zh: '全名', ja: '氏名', ko: '이름', ar: 'الاسم الكامل', it: 'Nome e cognome' }],
  ['Street address', { es: 'Dirección', fr: 'Adresse', de: 'Straße und Hausnummer', pt: 'Endereço', zh: '街道地址', ja: '番地', ko: '도로명 주소', ar: 'عنوان الشارع', it: 'Indirizzo' }],
  ['Start typing your address', { es: 'Empieza a escribir tu dirección', fr: 'Commencez à saisir votre adresse', de: 'Beginne, deine Adresse einzugeben', pt: 'Comece a digitar seu endereço', zh: '开始输入您的地址', ja: '住所を入力してください', ko: '주소를 입력하세요', ar: 'ابدأ بكتابة عنوانك', it: 'Inizia a digitare l’indirizzo' }],
  ['Apt, suite, etc. (optional)', { es: 'Piso, puerta, etc. (opcional)', fr: 'Appartement, bâtiment, etc. (facultatif)', de: 'Wohnung, Etage usw. (optional)', pt: 'Apto, bloco etc. (opcional)', zh: '公寓、单元等（选填）', ja: '建物名・部屋番号（任意）', ko: '아파트, 동·호수 등(선택)', ar: 'الشقة، الجناح، إلخ (اختياري)', it: 'Interno, scala, ecc. (facoltativo)' }],
  ['City', { es: 'Ciudad', fr: 'Ville', de: 'Stadt', pt: 'Cidade', zh: '城市', ja: '市区町村', ko: '도시', ar: 'المدينة', it: 'Città' }],
  ['State', { es: 'Estado', fr: 'État', de: 'Bundesstaat', pt: 'Estado', zh: '州', ja: '州', ko: '주', ar: 'الولاية', it: 'Stato' }],
  ['State / Province', { es: 'Estado / Provincia', fr: 'État / Province', de: 'Bundesland / Provinz', pt: 'Estado / Província', zh: '州 / 省', ja: '州 / 都道府県', ko: '주 / 도', ar: 'الولاية / المقاطعة', it: 'Stato / Provincia' }],
  ['ZIP code', { es: 'Código postal', fr: 'Code postal', de: 'Postleitzahl', pt: 'CEP', zh: '邮编', ja: '郵便番号', ko: '우편번호', ar: 'الرمز البريدي', it: 'CAP' }],
  ['Postal code', { es: 'Código postal', fr: 'Code postal', de: 'Postleitzahl', pt: 'Código postal', zh: '邮政编码', ja: '郵便番号', ko: '우편번호', ar: 'الرمز البريدي', it: 'Codice postale' }],
  ['Country', { es: 'País', fr: 'Pays', de: 'Land', pt: 'País', zh: '国家/地区', ja: '国', ko: '국가', ar: 'الدولة', it: 'Paese' }],
  ['Select', { es: 'Seleccionar', fr: 'Sélectionner', de: 'Auswählen', pt: 'Selecionar', zh: '选择', ja: '選択', ko: '선택', ar: 'اختر', it: 'Seleziona' }],
  ['Save to my addresses', { es: 'Guardar en mis direcciones', fr: 'Enregistrer dans mes adresses', de: 'In meinen Adressen speichern', pt: 'Salvar nos meus endereços', zh: '保存到我的地址', ja: '住所録に保存', ko: '내 주소에 저장', ar: 'احفظ في عناويني', it: 'Salva nei miei indirizzi' }],
  ['Use it again next time', { es: 'Úsala la próxima vez', fr: 'Réutilisez-la la prochaine fois', de: 'Beim nächsten Mal wiederverwenden', pt: 'Use de novo na próxima vez', zh: '下次直接使用', ja: '次回も使えます', ko: '다음에도 사용', ar: 'استخدمه مرة أخرى في المرة القادمة', it: 'Riutilizzalo la prossima volta' }],
  ['Saved address', { es: 'Dirección guardada', fr: 'Adresse enregistrée', de: 'Gespeicherte Adresse', pt: 'Endereço salvo', zh: '已保存的地址', ja: '保存済みの住所', ko: '저장된 주소', ar: 'عنوان محفوظ', it: 'Indirizzo salvato' }],
  ['Use a new address', { es: 'Usar una dirección nueva', fr: 'Utiliser une nouvelle adresse', de: 'Neue Adresse verwenden', pt: 'Usar um novo endereço', zh: '使用新地址', ja: '新しい住所を使う', ko: '새 주소 사용', ar: 'استخدم عنوانًا جديدًا', it: 'Usa un nuovo indirizzo' }],

  // ── Payment ──────────────────────────────────────────────────────────────
  ['Payment', { es: 'Pago', fr: 'Paiement', de: 'Zahlung', pt: 'Pagamento', zh: '付款', ja: 'お支払い', ko: '결제 수단', ar: 'الدفع', it: 'Pagamento' }],
  ['This order won’t be charged.', { es: 'Este pedido no se cobrará.', fr: 'Cette commande ne sera pas débitée.', de: 'Diese Bestellung wird nicht berechnet.', pt: 'Este pedido não será cobrado.', zh: '此订单不会扣款。', ja: 'この注文は請求されません。', ko: '이 주문은 청구되지 않습니다.', ar: 'لن يتم تحصيل مبلغ هذا الطلب.', it: 'Questo ordine non verrà addebitato.' }],
  ['Card, Apple Pay or Google Pay', { es: 'Tarjeta, Apple Pay o Google Pay', fr: 'Carte, Apple Pay ou Google Pay', de: 'Karte, Apple Pay oder Google Pay', pt: 'Cartão, Apple Pay ou Google Pay', zh: '银行卡、Apple Pay 或 Google Pay', ja: 'カード、Apple Pay、Google Pay', ko: '카드, Apple Pay 또는 Google Pay', ar: 'بطاقة أو Apple Pay أو Google Pay', it: 'Carta, Apple Pay o Google Pay' }],
  ['Entered on Stripe’s secure page after you tap Pay', { es: 'Se introduce en la página segura de Stripe al tocar Pagar', fr: 'Saisie sur la page sécurisée de Stripe après avoir touché Payer', de: 'Wird nach Tippen auf Bezahlen auf der sicheren Stripe-Seite eingegeben', pt: 'Informado na página segura da Stripe depois de tocar em Pagar', zh: '点击支付后在 Stripe 安全页面填写', ja: '「支払う」をタップした後、Stripeの安全なページで入力します', ko: '결제를 누른 후 Stripe 보안 페이지에서 입력합니다', ar: 'تُدخل في صفحة Stripe الآمنة بعد الضغط على ادفع', it: 'Inserita sulla pagina sicura di Stripe dopo aver toccato Paga' }],
  ['Use a new card', { es: 'Usar una tarjeta nueva', fr: 'Utiliser une nouvelle carte', de: 'Neue Karte verwenden', pt: 'Usar um novo cartão', zh: '使用新银行卡', ja: '新しいカードを使う', ko: '새 카드 사용', ar: 'استخدم بطاقة جديدة', it: 'Usa una nuova carta' }],
  ['Default', { es: 'Predeterminada', fr: 'Par défaut', de: 'Standard', pt: 'Padrão', zh: '默认', ja: 'デフォルト', ko: '기본', ar: 'افتراضية', it: 'Predefinita' }],
  ['Expires {date}', { es: 'Caduca {date}', fr: 'Expire {date}', de: 'Gültig bis {date}', pt: 'Expira {date}', zh: '有效期至 {date}', ja: '有効期限 {date}', ko: '만료 {date}', ar: 'تنتهي {date}', it: 'Scade {date}' }],
  ['Saved card', { es: 'Tarjeta guardada', fr: 'Carte enregistrée', de: 'Gespeicherte Karte', pt: 'Cartão salvo', zh: '已保存的银行卡', ja: '保存済みのカード', ko: '저장된 카드', ar: 'بطاقة محفوظة', it: 'Carta salvata' }],
  ['or', { es: 'o', fr: 'ou', de: 'oder', pt: 'ou', zh: '或', ja: 'または', ko: '또는', ar: 'أو', it: 'oppure' }],
  ['Express checkout', { es: 'Pago exprés', fr: 'Paiement express', de: 'Express-Kasse', pt: 'Finalização expressa', zh: '快速结账', ja: 'エクスプレス購入', ko: '빠른 결제', ar: 'دفع سريع', it: 'Pagamento rapido' }],
  ['Secured by Stripe. Items from {count} sellers are paid in {count} separate secure payments.', { es: 'Protegido por Stripe. Los artículos de {count} vendedores se pagan en {count} pagos seguros separados.', fr: 'Sécurisé par Stripe. Les articles de {count} vendeurs sont réglés en {count} paiements sécurisés distincts.', de: 'Gesichert durch Stripe. Artikel von {count} Verkäufern werden in {count} separaten sicheren Zahlungen bezahlt.', pt: 'Protegido pela Stripe. Os itens de {count} vendedores são pagos em {count} pagamentos seguros separados.', zh: '由 Stripe 提供安全保障。来自 {count} 位卖家的商品将分 {count} 笔安全付款。', ja: 'Stripeで保護されています。{count}つのショップの商品は{count}回に分けて安全にお支払いいただきます。', ko: 'Stripe로 보호됩니다. 판매자 {count}곳의 상품은 {count}번의 보안 결제로 나뉘어 결제됩니다.', ar: 'محمي بواسطة Stripe. تُدفع منتجات {count} بائعين في {count} دفعات آمنة منفصلة.', it: 'Protetto da Stripe. Gli articoli di {count} venditori si pagano con {count} pagamenti sicuri separati.' }],
  ['Secured by Stripe. One payment covers all {count} sellers. Brandthread never sees your card number.', { es: 'Protegido por Stripe. Un solo pago cubre a los {count} vendedores. Brandthread nunca ve el número de tu tarjeta.', fr: 'Sécurisé par Stripe. Un seul paiement couvre les {count} vendeurs. Brandthread ne voit jamais votre numéro de carte.', de: 'Gesichert durch Stripe. Eine Zahlung deckt alle {count} Verkäufer ab. Brandthread sieht deine Kartennummer nie.', pt: 'Protegido pela Stripe. Um único pagamento cobre os {count} vendedores. A Brandthread nunca vê o número do seu cartão.', zh: '由 Stripe 提供安全保障。一笔付款即可支付全部 {count} 位卖家。Brandthread 不会看到您的卡号。', ja: 'Stripeで保護されています。1回のお支払いで{count}つのショップすべてをお支払いいただけます。Brandthreadがカード番号を見ることはありません。', ko: 'Stripe로 보호됩니다. 한 번의 결제로 판매자 {count}곳 모두 결제됩니다. Brandthread는 카드 번호를 볼 수 없습니다.', ar: 'محمي بواسطة Stripe. دفعة واحدة تغطي جميع البائعين الـ {count}. لا ترى Brandthread رقم بطاقتك أبدًا.', it: 'Protetto da Stripe. Un solo pagamento copre tutti i {count} venditori. Brandthread non vede mai il numero della carta.' }],
  ['Secured by Stripe. Brandthread never sees or stores your card number.', { es: 'Protegido por Stripe. Brandthread nunca ve ni guarda el número de tu tarjeta.', fr: 'Sécurisé par Stripe. Brandthread ne voit ni ne conserve jamais votre numéro de carte.', de: 'Gesichert durch Stripe. Brandthread sieht oder speichert deine Kartennummer nie.', pt: 'Protegido pela Stripe. A Brandthread nunca vê nem armazena o número do seu cartão.', zh: '由 Stripe 提供安全保障。Brandthread 不会查看或存储您的卡号。', ja: 'Stripeで保護されています。Brandthreadがカード番号を閲覧・保存することはありません。', ko: 'Stripe로 보호됩니다. Brandthread는 카드 번호를 보거나 저장하지 않습니다.', ar: 'محمي بواسطة Stripe. لا ترى Brandthread رقم بطاقتك ولا تخزّنه أبدًا.', it: 'Protetto da Stripe. Brandthread non vede né conserva mai il numero della carta.' }],

  // ── Promo code ───────────────────────────────────────────────────────────
  ['Promo code', { es: 'Código promocional', fr: 'Code promo', de: 'Aktionscode', pt: 'Código promocional', zh: '优惠码', ja: 'プロモーションコード', ko: '프로모션 코드', ar: 'رمز الخصم', it: 'Codice promozionale' }],
  ['{code} applied', { es: '{code} aplicado', fr: '{code} appliqué', de: '{code} angewendet', pt: '{code} aplicado', zh: '已使用 {code}', ja: '{code} を適用済み', ko: '{code} 적용됨', ar: 'تم تطبيق {code}', it: '{code} applicato' }],
  ['Remove', { es: 'Quitar', fr: 'Retirer', de: 'Entfernen', pt: 'Remover', zh: '移除', ja: '削除', ko: '삭제', ar: 'إزالة', it: 'Rimuovi' }],
  ['Code', { es: 'Código', fr: 'Code', de: 'Code', pt: 'Código', zh: '代码', ja: 'コード', ko: '코드', ar: 'الرمز', it: 'Codice' }],
  ['Enter promo code', { es: 'Introduce el código', fr: 'Saisissez le code promo', de: 'Aktionscode eingeben', pt: 'Insira o código', zh: '输入优惠码', ja: 'コードを入力', ko: '프로모션 코드 입력', ar: 'أدخل رمز الخصم', it: 'Inserisci il codice' }],
  ['Apply', { es: 'Aplicar', fr: 'Appliquer', de: 'Anwenden', pt: 'Aplicar', zh: '使用', ja: '適用', ko: '적용', ar: 'تطبيق', it: 'Applica' }],
  ['That code isn’t valid for this order.', { es: 'Ese código no es válido para este pedido.', fr: 'Ce code n’est pas valable pour cette commande.', de: 'Dieser Code gilt nicht für diese Bestellung.', pt: 'Esse código não é válido para este pedido.', zh: '该代码不适用于此订单。', ja: 'このコードはこの注文には使えません。', ko: '이 주문에 사용할 수 없는 코드입니다.', ar: 'هذا الرمز غير صالح لهذا الطلب.', it: 'Il codice non è valido per questo ordine.' }],
  ['We couldn’t check that code. Check your connection and try again.', { es: 'No pudimos comprobar ese código. Revisa tu conexión e inténtalo de nuevo.', fr: 'Impossible de vérifier ce code. Vérifiez votre connexion et réessayez.', de: 'Der Code konnte nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut.', pt: 'Não foi possível verificar esse código. Verifique sua conexão e tente novamente.', zh: '无法验证该代码。请检查网络连接后重试。', ja: 'コードを確認できませんでした。接続を確認してもう一度お試しください。', ko: '코드를 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.', ar: 'تعذّر التحقق من هذا الرمز. تحقّق من اتصالك وحاول مرة أخرى.', it: 'Impossibile verificare il codice. Controlla la connessione e riprova.' }],

  // ── Tip ──────────────────────────────────────────────────────────────────
  ['Tip', { es: 'Propina', fr: 'Pourboire', de: 'Trinkgeld', pt: 'Gorjeta', zh: '小费', ja: 'チップ', ko: '팁', ar: 'إكرامية', it: 'Mancia' }],
  ['Tip {name}', { es: 'Propina para {name}', fr: 'Pourboire pour {name}', de: 'Trinkgeld für {name}', pt: 'Gorjeta para {name}', zh: '给 {name} 的小费', ja: '{name}へのチップ', ko: '{name}에 팁', ar: 'إكرامية لـ {name}', it: 'Mancia per {name}' }],
  ['No tip', { es: 'Sin propina', fr: 'Pas de pourboire', de: 'Kein Trinkgeld', pt: 'Sem gorjeta', zh: '不付小费', ja: 'チップなし', ko: '팁 없음', ar: 'بدون إكرامية', it: 'Nessuna mancia' }],
  ['Custom amount', { es: 'Otro importe', fr: 'Autre montant', de: 'Eigener Betrag', pt: 'Outro valor', zh: '自定义金额', ja: '金額を指定', ko: '직접 입력', ar: 'مبلغ مخصّص', it: 'Importo personalizzato' }],
  ['Tip amount', { es: 'Importe de la propina', fr: 'Montant du pourboire', de: 'Trinkgeldbetrag', pt: 'Valor da gorjeta', zh: '小费金额', ja: 'チップの金額', ko: '팁 금액', ar: 'مبلغ الإكرامية', it: 'Importo della mancia' }],
  ['Enter an amount up to {amount}', { es: 'Introduce un importe de hasta {amount}', fr: 'Saisissez un montant jusqu’à {amount}', de: 'Gib einen Betrag bis {amount} ein', pt: 'Insira um valor de até {amount}', zh: '请输入不超过 {amount} 的金额', ja: '{amount}以下の金額を入力してください', ko: '{amount} 이하의 금액을 입력하세요', ar: 'أدخل مبلغًا حتى {amount}', it: 'Inserisci un importo fino a {amount}' }],

  // ── Order summary ────────────────────────────────────────────────────────
  ['Order summary', { es: 'Resumen del pedido', fr: 'Récapitulatif', de: 'Bestellübersicht', pt: 'Resumo do pedido', zh: '订单摘要', ja: '注文内容', ko: '주문 요약', ar: 'ملخص الطلب', it: 'Riepilogo dell’ordine' }],
  ['From {name}', { es: 'De {name}', fr: 'De {name}', de: 'Von {name}', pt: 'De {name}', zh: '来自 {name}', ja: '{name}より', ko: '{name}', ar: 'من {name}', it: 'Da {name}' }],
  ['Qty {n}', { es: 'Cant. {n}', fr: 'Qté {n}', de: 'Menge {n}', pt: 'Qtd. {n}', zh: '数量 {n}', ja: '数量 {n}', ko: '수량 {n}', ar: 'الكمية {n}', it: 'Qtà {n}' }],
  ['Pre-order', { es: 'Preventa', fr: 'Précommande', de: 'Vorbestellung', pt: 'Pré-venda', zh: '预购', ja: '予約注文', ko: '예약 주문', ar: 'طلب مسبق', it: 'Preordine' }],
  ['ships {date}', { es: 'se envía {date}', fr: 'expédié {date}', de: 'Versand {date}', pt: 'envio {date}', zh: '{date} 发货', ja: '{date}発送', ko: '{date} 발송', ar: 'يُشحن {date}', it: 'spedizione {date}' }],
  ['No delivery option available', { es: 'No hay opciones de entrega', fr: 'Aucun mode de livraison disponible', de: 'Keine Versandoption verfügbar', pt: 'Nenhuma opção de entrega disponível', zh: '暂无配送方式', ja: '利用できる配送方法がありません', ko: '사용 가능한 배송 옵션이 없습니다', ar: 'لا يتوفر خيار توصيل', it: 'Nessuna opzione di consegna disponibile' }],
  ['Free', { es: 'Gratis', fr: 'Gratuite', de: 'Kostenlos', pt: 'Grátis', zh: '免费', ja: '無料', ko: '무료', ar: 'مجاني', it: 'Gratis' }],
  ['We couldn’t get a shipping rate from {name}. Try again in a moment.', { es: 'No pudimos obtener una tarifa de envío de {name}. Inténtalo en un momento.', fr: 'Impossible d’obtenir un tarif de livraison de {name}. Réessayez dans un instant.', de: 'Von {name} kam kein Versandtarif. Versuche es gleich erneut.', pt: 'Não foi possível obter o frete de {name}. Tente novamente em instantes.', zh: '无法获取 {name} 的运费。请稍后重试。', ja: '{name}の送料を取得できませんでした。しばらくしてからもう一度お試しください。', ko: '{name}의 배송비를 가져오지 못했습니다. 잠시 후 다시 시도하세요.', ar: 'تعذّر الحصول على سعر الشحن من {name}. حاول مرة أخرى بعد قليل.', it: 'Impossibile ottenere la tariffa di spedizione da {name}. Riprova tra poco.' }],
  ['Subtotal ({n} item)', { es: 'Subtotal ({n} artículo)', fr: 'Sous-total ({n} article)', de: 'Zwischensumme ({n} Artikel)', pt: 'Subtotal ({n} item)', zh: '小计（{n} 件）', ja: '小計（{n}点）', ko: '소계({n}개)', ar: 'المجموع الفرعي ({n} منتج)', it: 'Subtotale ({n} articolo)' }],
  ['Subtotal ({n} items)', { es: 'Subtotal ({n} artículos)', fr: 'Sous-total ({n} articles)', de: 'Zwischensumme ({n} Artikel)', pt: 'Subtotal ({n} itens)', zh: '小计（{n} 件）', ja: '小計（{n}点）', ko: '소계({n}개)', ar: 'المجموع الفرعي ({n} منتجات)', it: 'Subtotale ({n} articoli)' }],
  ['Shipping', { es: 'Envío', fr: 'Livraison', de: 'Versand', pt: 'Frete', zh: '运费', ja: '送料', ko: '배송비', ar: 'الشحن', it: 'Spedizione' }],
  ['Tax', { es: 'Impuestos', fr: 'Taxes', de: 'Steuer', pt: 'Impostos', zh: '税费', ja: '税', ko: '세금', ar: 'الضريبة', it: 'Imposte' }],
  ['Discount', { es: 'Descuento', fr: 'Réduction', de: 'Rabatt', pt: 'Desconto', zh: '折扣', ja: '割引', ko: '할인', ar: 'الخصم', it: 'Sconto' }],
  ['Rewards', { es: 'Recompensas', fr: 'Récompenses', de: 'Prämien', pt: 'Recompensas', zh: '奖励', ja: 'リワード', ko: '리워드', ar: 'المكافآت', it: 'Premi' }],
  ['Order total', { es: 'Total del pedido', fr: 'Total de la commande', de: 'Bestellsumme', pt: 'Total do pedido', zh: '订单总额', ja: '注文合計', ko: '주문 합계', ar: 'إجمالي الطلب', it: 'Totale ordine' }],
  ['Thread Cash', { es: 'Thread Cash', fr: 'Thread Cash', de: 'Thread Cash', pt: 'Thread Cash', zh: 'Thread Cash', ja: 'Thread Cash', ko: 'Thread Cash', ar: 'Thread Cash', it: 'Thread Cash' }],
  ['Charged to card', { es: 'Cargado a la tarjeta', fr: 'Débité sur la carte', de: 'Karte belastet', pt: 'Cobrado no cartão', zh: '银行卡扣款', ja: 'カードへの請求額', ko: '카드 청구액', ar: 'المبلغ المخصوم من البطاقة', it: 'Addebitato sulla carta' }],
  ['Total', { es: 'Total', fr: 'Total', de: 'Gesamt', pt: 'Total', zh: '总计', ja: '合計', ko: '합계', ar: 'الإجمالي', it: 'Totale' }],
  ['Ships after production', { es: 'Se envía tras la producción', fr: 'Expédié après production', de: 'Versand nach der Produktion', pt: 'Envio após a produção', zh: '生产完成后发货', ja: '製造後に発送', ko: '제작 후 발송', ar: 'يُشحن بعد الإنتاج', it: 'Spedito dopo la produzione' }],
  ['Ships in 1 business day', { es: 'Se envía en 1 día hábil', fr: 'Expédié sous 1 jour ouvré', de: 'Versand in 1 Werktag', pt: 'Envio em 1 dia útil', zh: '1 个工作日内发货', ja: '1営業日以内に発送', ko: '영업일 기준 1일 내 발송', ar: 'يُشحن خلال يوم عمل واحد', it: 'Spedito in 1 giorno lavorativo' }],
  ['Ships in {n} business days', { es: 'Se envía en {n} días hábiles', fr: 'Expédié sous {n} jours ouvrés', de: 'Versand in {n} Werktagen', pt: 'Envio em {n} dias úteis', zh: '{n} 个工作日内发货', ja: '{n}営業日以内に発送', ko: '영업일 기준 {n}일 내 발송', ar: 'يُشحن خلال {n} أيام عمل', it: 'Spedito in {n} giorni lavorativi' }],
  ['Ships in 3–5 business days', { es: 'Se envía en 3–5 días hábiles', fr: 'Expédié sous 3 à 5 jours ouvrés', de: 'Versand in 3–5 Werktagen', pt: 'Envio em 3–5 dias úteis', zh: '3–5 个工作日内发货', ja: '3〜5営業日以内に発送', ko: '영업일 기준 3–5일 내 발송', ar: 'يُشحن خلال 3–5 أيام عمل', it: 'Spedito in 3–5 giorni lavorativi' }],
  ['By placing your order you agree to the {terms} and {privacy}.', { es: 'Al realizar tu pedido aceptas los {terms} y la {privacy}.', fr: 'En passant commande, vous acceptez les {terms} et la {privacy}.', de: 'Mit deiner Bestellung stimmst du den {terms} und der {privacy} zu.', pt: 'Ao fazer seu pedido, você concorda com os {terms} e a {privacy}.', zh: '下单即表示您同意{terms}和{privacy}。', ja: 'ご注文により、{terms}および{privacy}に同意したものとみなされます。', ko: '주문하면 {terms} 및 {privacy}에 동의하게 됩니다.', ar: 'بتقديم طلبك فإنك توافق على {terms} و{privacy}.', it: 'Effettuando l’ordine accetti i {terms} e l’{privacy}.' }],
  ['Terms of Service', { es: 'Términos del servicio', fr: 'Conditions d’utilisation', de: 'Nutzungsbedingungen', pt: 'Termos de Serviço', zh: '服务条款', ja: '利用規約', ko: '서비스 약관', ar: 'شروط الخدمة', it: 'Termini di servizio' }],
  ['Privacy Policy', { es: 'Política de privacidad', fr: 'Politique de confidentialité', de: 'Datenschutzerklärung', pt: 'Política de Privacidade', zh: '隐私政策', ja: 'プライバシーポリシー', ko: '개인정보처리방침', ar: 'سياسة الخصوصية', it: 'Informativa sulla privacy' }],

  // ── Confirmation ─────────────────────────────────────────────────────────
  ['Payment received', { es: 'Pago recibido', fr: 'Paiement reçu', de: 'Zahlung erhalten', pt: 'Pagamento recebido', zh: '已收到付款', ja: 'お支払いを受け付けました', ko: '결제 완료', ar: 'تم استلام الدفعة', it: 'Pagamento ricevuto' }],
  ['Order confirmed', { es: 'Pedido confirmado', fr: 'Commande confirmée', de: 'Bestellung bestätigt', pt: 'Pedido confirmado', zh: '订单已确认', ja: 'ご注文が確定しました', ko: '주문 확정', ar: 'تم تأكيد الطلب', it: 'Ordine confermato' }],
  ['Order {number}', { es: 'Pedido {number}', fr: 'Commande {number}', de: 'Bestellung {number}', pt: 'Pedido {number}', zh: '订单 {number}', ja: '注文 {number}', ko: '주문 {number}', ar: 'الطلب {number}', it: 'Ordine {number}' }],
  ['Assigned once payment is confirmed', { es: 'Se asigna al confirmar el pago', fr: 'Attribué une fois le paiement confirmé', de: 'Wird nach Zahlungsbestätigung vergeben', pt: 'Atribuído após a confirmação do pagamento', zh: '付款确认后分配', ja: 'お支払い確認後に発行されます', ko: '결제 확인 후 부여됩니다', ar: 'يُخصَّص بعد تأكيد الدفع', it: 'Assegnato a pagamento confermato' }],
  ['We’re finalizing your order with the seller. This can take a moment after payment.', { es: 'Estamos finalizando tu pedido con el vendedor. Puede tardar un momento después del pago.', fr: 'Nous finalisons votre commande avec le vendeur. Cela peut prendre un instant après le paiement.', de: 'Wir schließen deine Bestellung mit dem Verkäufer ab. Das kann nach der Zahlung einen Moment dauern.', pt: 'Estamos finalizando seu pedido com o vendedor. Isso pode levar um momento após o pagamento.', zh: '我们正在与卖家确认您的订单，付款后可能需要一点时间。', ja: 'ショップとご注文を確定しています。お支払い後、少し時間がかかる場合があります。', ko: '판매자와 주문을 마무리하고 있습니다. 결제 후 잠시 걸릴 수 있습니다.', ar: 'نُنهي طلبك مع البائع. قد يستغرق ذلك لحظة بعد الدفع.', it: 'Stiamo finalizzando l’ordine con il venditore. Può richiedere un momento dopo il pagamento.' }],
  ['Estimated delivery', { es: 'Entrega estimada', fr: 'Livraison estimée', de: 'Voraussichtliche Lieferung', pt: 'Entrega estimada', zh: '预计送达', ja: 'お届け予定', ko: '예상 배송', ar: 'التوصيل المتوقع', it: 'Consegna stimata' }],
  ['Seller will confirm delivery date', { es: 'El vendedor confirmará la fecha de entrega', fr: 'Le vendeur confirmera la date de livraison', de: 'Der Verkäufer bestätigt das Lieferdatum', pt: 'O vendedor confirmará a data de entrega', zh: '卖家将确认送达日期', ja: 'お届け日はショップが確定します', ko: '판매자가 배송일을 확정합니다', ar: 'سيؤكد البائع تاريخ التوصيل', it: 'Il venditore confermerà la data di consegna' }],
  ['Arrives in {n} shipments', { es: 'Llega en {n} envíos', fr: 'Arrive en {n} colis', de: 'Kommt in {n} Lieferungen', pt: 'Chega em {n} envios', zh: '分 {n} 个包裹送达', ja: '{n}回に分けてお届け', ko: '{n}회에 나누어 도착', ar: 'يصل في {n} شحنات', it: 'Arriva in {n} spedizioni' }],
  ['Ships to', { es: 'Enviar a', fr: 'Livré à', de: 'Lieferung an', pt: 'Entregar em', zh: '寄送至', ja: 'お届け先', ko: '배송지', ar: 'يُشحن إلى', it: 'Spedire a' }],
  ['Message {name}', { es: 'Escribir a {name}', fr: 'Écrire à {name}', de: '{name} schreiben', pt: 'Mensagem para {name}', zh: '联系 {name}', ja: '{name}にメッセージ', ko: '{name}에 메시지', ar: 'راسل {name}', it: 'Scrivi a {name}' }],
  ['Questions about sizing, shipping or your order', { es: 'Dudas sobre tallas, envío o tu pedido', fr: 'Questions sur les tailles, la livraison ou votre commande', de: 'Fragen zu Größen, Versand oder deiner Bestellung', pt: 'Dúvidas sobre tamanho, envio ou seu pedido', zh: '关于尺码、配送或订单的问题', ja: 'サイズ、配送、ご注文についてのご質問', ko: '사이즈, 배송, 주문 관련 문의', ar: 'أسئلة حول المقاسات أو الشحن أو طلبك', it: 'Domande su taglie, spedizione o ordine' }],
  ['View receipt', { es: 'Ver recibo', fr: 'Voir le reçu', de: 'Beleg anzeigen', pt: 'Ver recibo', zh: '查看收据', ja: '領収書を見る', ko: '영수증 보기', ar: 'عرض الإيصال', it: 'Vedi ricevuta' }],
  ['Continue shopping', { es: 'Seguir comprando', fr: 'Continuer vos achats', de: 'Weiter einkaufen', pt: 'Continuar comprando', zh: '继续购物', ja: '買い物を続ける', ko: '쇼핑 계속하기', ar: 'متابعة التسوق', it: 'Continua lo shopping' }],
  ['Create an account to track orders faster', { es: 'Crea una cuenta para seguir tus pedidos más rápido', fr: 'Créez un compte pour suivre vos commandes plus vite', de: 'Erstelle ein Konto, um Bestellungen schneller zu verfolgen', pt: 'Crie uma conta para acompanhar pedidos mais rápido', zh: '创建账户，更快追踪订单', ja: 'アカウントを作成して注文をすばやく追跡', ko: '계정을 만들어 주문을 더 빠르게 추적하세요', ar: 'أنشئ حسابًا لتتبّع طلباتك أسرع', it: 'Crea un account per seguire gli ordini più velocemente' }],
  ['More from {name}', { es: 'Más de {name}', fr: 'Plus de {name}', de: 'Mehr von {name}', pt: 'Mais de {name}', zh: '{name} 的更多商品', ja: '{name}の他の商品', ko: '{name}의 다른 상품', ar: 'المزيد من {name}', it: 'Altro da {name}' }],
  ['Check order status', { es: 'Ver estado del pedido', fr: 'Voir le statut de la commande', de: 'Bestellstatus prüfen', pt: 'Ver status do pedido', zh: '查看订单状态', ja: '注文状況を確認', ko: '주문 상태 확인', ar: 'تحقّق من حالة الطلب', it: 'Controlla lo stato dell’ordine' }],
  ['Track order', { es: 'Seguir pedido', fr: 'Suivre la commande', de: 'Bestellung verfolgen', pt: 'Rastrear pedido', zh: '追踪订单', ja: '注文を追跡', ko: '주문 추적', ar: 'تتبّع الطلب', it: 'Traccia ordine' }],

  // ── Post-purchase offer ──────────────────────────────────────────────────
  ['Add to your order', { es: 'Añádelo a tu pedido', fr: 'Ajoutez à votre commande', de: 'Zu deiner Bestellung hinzufügen', pt: 'Adicione ao seu pedido', zh: '加入您的订单', ja: 'ご注文に追加', ko: '주문에 추가하세요', ar: 'أضِف إلى طلبك', it: 'Aggiungi al tuo ordine' }],
  ['{percent}% off', { es: '{percent}% de descuento', fr: '-{percent} %', de: '{percent} % Rabatt', pt: '{percent}% de desconto', zh: '{percent}% 折扣', ja: '{percent}%オフ', ko: '{percent}% 할인', ar: 'خصم {percent}%', it: '{percent}% di sconto' }],
  ['Ships with order {number}. No extra shipping.', { es: 'Se envía con el pedido {number}. Sin gastos de envío adicionales.', fr: 'Expédié avec la commande {number}. Sans frais de livraison en plus.', de: 'Wird mit Bestellung {number} versendet. Keine zusätzlichen Versandkosten.', pt: 'Enviado com o pedido {number}. Sem frete adicional.', zh: '与订单 {number} 一起发货，无需额外运费。', ja: '注文{number}と一緒に発送します。追加の送料はかかりません。', ko: '주문 {number}과 함께 발송됩니다. 추가 배송비가 없습니다.', ar: 'يُشحن مع الطلب {number}. بدون رسوم شحن إضافية.', it: 'Spedito con l’ordine {number}. Nessun costo di spedizione aggiuntivo.' }],
  ['Pay now with {card}. Tax is added at payment.', { es: 'Paga ahora con {card}. Los impuestos se añaden al pagar.', fr: 'Payez maintenant avec {card}. Les taxes sont ajoutées au paiement.', de: 'Jetzt mit {card} bezahlen. Steuern kommen beim Bezahlen hinzu.', pt: 'Pague agora com {card}. Impostos são adicionados no pagamento.', zh: '立即使用 {card} 付款，税费在付款时计算。', ja: '{card}で今すぐお支払い。税はお支払い時に加算されます。', ko: '{card}(으)로 지금 결제합니다. 세금은 결제 시 추가됩니다.', ar: 'ادفع الآن باستخدام {card}. تُضاف الضريبة عند الدفع.', it: 'Paga ora con {card}. Le imposte si aggiungono al pagamento.' }],
  ['Add to order · {amount}', { es: 'Añadir al pedido · {amount}', fr: 'Ajouter à la commande · {amount}', de: 'Zur Bestellung hinzufügen · {amount}', pt: 'Adicionar ao pedido · {amount}', zh: '加入订单 · {amount}', ja: '注文に追加 · {amount}', ko: '주문에 추가 · {amount}', ar: 'أضِف إلى الطلب · {amount}', it: 'Aggiungi all’ordine · {amount}' }],
  ['Option', { es: 'Opción', fr: 'Option', de: 'Variante', pt: 'Opção', zh: '选项', ja: 'オプション', ko: '옵션', ar: 'الخيار', it: 'Opzione' }],
  ['Sold out', { es: 'Agotado', fr: 'Épuisé', de: 'Ausverkauft', pt: 'Esgotado', zh: '已售罄', ja: '売り切れ', ko: '품절', ar: 'نفد', it: 'Esaurito' }],
  ['No thanks', { es: 'No, gracias', fr: 'Non merci', de: 'Nein danke', pt: 'Não, obrigado', zh: '不用了', ja: '今回は追加しない', ko: '괜찮습니다', ar: 'لا شكرًا', it: 'No, grazie' }],
  ['Added to your order', { es: 'Añadido a tu pedido', fr: 'Ajouté à votre commande', de: 'Zu deiner Bestellung hinzugefügt', pt: 'Adicionado ao seu pedido', zh: '已加入您的订单', ja: 'ご注文に追加しました', ko: '주문에 추가되었습니다', ar: 'أُضيف إلى طلبك', it: 'Aggiunto al tuo ordine' }],
  ['Charged {amount} to {card}.', { es: 'Se cobraron {amount} a {card}.', fr: '{amount} débités sur {card}.', de: '{amount} wurden {card} belastet.', pt: '{amount} cobrados em {card}.', zh: '已从 {card} 扣款 {amount}。', ja: '{card}に{amount}を請求しました。', ko: '{card}에 {amount}이(가) 청구되었습니다.', ar: 'تم خصم {amount} من {card}.', it: 'Addebitati {amount} su {card}.' }],
  ['your card', { es: 'tu tarjeta', fr: 'votre carte', de: 'deine Karte', pt: 'seu cartão', zh: '您的银行卡', ja: 'お使いのカード', ko: '카드', ar: 'بطاقتك', it: 'la tua carta' }],
  ['We couldn’t add this to your order. You haven’t been charged.', { es: 'No pudimos añadirlo a tu pedido. No se te ha cobrado.', fr: 'Impossible de l’ajouter à votre commande. Vous n’avez pas été débité.', de: 'Das konnte nicht hinzugefügt werden. Dir wurde nichts berechnet.', pt: 'Não foi possível adicionar ao seu pedido. Você não foi cobrado.', zh: '无法加入您的订单。您尚未被扣款。', ja: 'ご注文に追加できませんでした。請求は発生していません。', ko: '주문에 추가하지 못했습니다. 청구되지 않았습니다.', ar: 'تعذّرت إضافة هذا إلى طلبك. لم يتم خصم أي مبلغ.', it: 'Impossibile aggiungerlo all’ordine. Non ti è stato addebitato nulla.' }],
  ['This offer has expired.', { es: 'Esta oferta ha caducado.', fr: 'Cette offre a expiré.', de: 'Dieses Angebot ist abgelaufen.', pt: 'Esta oferta expirou.', zh: '此优惠已过期。', ja: 'このオファーは期限切れです。', ko: '이 혜택은 만료되었습니다.', ar: 'انتهت صلاحية هذا العرض.', it: 'Questa offerta è scaduta.' }],
  ['This item just sold out.', { es: 'Este artículo se acaba de agotar.', fr: 'Cet article vient d’être épuisé.', de: 'Dieser Artikel ist gerade ausverkauft.', pt: 'Este item acabou de esgotar.', zh: '该商品刚刚售罄。', ja: 'この商品は売り切れました。', ko: '이 상품은 방금 품절되었습니다.', ar: 'نفد هذا المنتج للتو.', it: 'Questo articolo è appena esaurito.' }],
  ['This offer was already added to your order.', { es: 'Esta oferta ya se añadió a tu pedido.', fr: 'Cette offre a déjà été ajoutée à votre commande.', de: 'Dieses Angebot wurde bereits hinzugefügt.', pt: 'Esta oferta já foi adicionada ao seu pedido.', zh: '此优惠已加入您的订单。', ja: 'このオファーはすでにご注文に追加されています。', ko: '이 혜택은 이미 주문에 추가되었습니다.', ar: 'أُضيف هذا العرض إلى طلبك بالفعل.', it: 'Questa offerta è già stata aggiunta all’ordine.' }],
  ['Your bank needs to confirm this payment.', { es: 'Tu banco necesita confirmar este pago.', fr: 'Votre banque doit confirmer ce paiement.', de: 'Deine Bank muss diese Zahlung bestätigen.', pt: 'Seu banco precisa confirmar este pagamento.', zh: '您的银行需要确认此付款。', ja: 'カード会社による確認が必要です。', ko: '은행에서 이 결제를 확인해야 합니다.', ar: 'يحتاج مصرفك إلى تأكيد هذه الدفعة.', it: 'La banca deve confermare questo pagamento.' }],
];

const TABLE: Map<string, Record<Translated, string>> = new Map(ROWS.map(([en, tr]) => [en, tr]));

/** Every English string with a translation (tests check each row is complete). */
export const CHECKOUT_STRINGS: readonly string[] = ROWS.map(([en]) => en);
export const CHECKOUT_TRANSLATIONS: ReadonlyArray<readonly [string, Record<Translated, string>]> = ROWS;

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Templates with placeholders, as regexes that match their filled English form (positional groups: Hermes-safe). */
const PATTERNS: Array<{ re: RegExp; keys: string[]; en: string }> = ROWS
  .map(([en]) => en)
  .filter(en => /\{\w+\}/.test(en))
  .map(en => {
    const keys: string[] = [];
    const source = en.split(/(\{\w+\})/).map(part => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const seen = keys.indexOf(m[1]);
      if (seen >= 0) return `\\${seen + 1}`;
      keys.push(m[1]);
      return '(.+?)';
    }).join('');
    return { re: new RegExp(`^${source}$`), keys, en };
  });

/**
 * Translates checkout copy. `text` is the English string (a template with
 * `vars`, or already-filled English such as "Ships in 4 business days").
 */
export function translateCheckout(language: CheckoutLanguage, text: string, vars?: Record<string, string | number>): string {
  if (language === 'en') return fill(text, vars);
  const row = TABLE.get(text);
  if (row) return fill(row[language], vars);
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(text);
    if (match) {
      const groups: Record<string, string> = {};
      pattern.keys.forEach((key, index) => { groups[key] = match[index + 1]; });
      return fill(TABLE.get(pattern.en)![language], groups);
    }
  }
  return fill(text, vars);
}

/** Splits a translated template into text and placeholder parts (for inline links). */
export function templateParts(language: CheckoutLanguage, template: string): Array<{ text: string } | { slot: string }> {
  const translated = language === 'en' ? template : TABLE.get(template)?.[language] ?? template;
  return translated.split(/(\{\w+\})/).filter(Boolean).map(part => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m ? { slot: m[1] } : { text: part };
  });
}

/** Arabic is written right to left. */
export function isRtl(language: CheckoutLanguage): boolean {
  return language === 'ar';
}
