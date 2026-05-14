const fs = require('fs');
const path = require('path');

const translations = {
  fr: {
    hero: {
      badge: 'Nouveau · Sync Google Agenda 2 sens',
      title_1: 'Vos réservations.',
      title_2: 'Un seul endroit, serein.',
      cta_secondary: 'Voir comment ça marche',
      check_1: 'Sans carte bancaire',
      check_2: 'Plan gratuit à vie',
      check_3: 'Annulez à tout moment'
    },
    trust: { label: 'Faits confiance par 1 200+ professionnels à travers l’Europe' },
    stats: [
      { n: '3 200+', l: 'rendez-vous / mois', s: 'chez nos professionnels' },
      { n: '12 min', l: 'économisés par jour', s: 'vs. WhatsApp & appels' },
      { n: '98 %', l: 'taux de présence', s: 'grâce aux rappels SMS' },
      { n: '4,9 ★', l: 'G2 / Capterra', s: 'sur 240 avis vérifiés' }
    ],
    features: {
      pill: 'Fonctionnalités',
      title: 'Tout ce qu’il vous faut.',
      title_em: 'Rien de superflu.',
      desc: 'Nous avons conçu BranShee en écoutant les coachs, coiffeurs et thérapeutes. Le résultat : une façon plus sereine de gérer votre semaine.',
      tags: ['Réservation', 'Disponibilité', 'Paiement', 'Flexibilité', 'Personnalisation', 'Évolutions']
    },
    func_tags: ['Agenda', 'Réservation', 'Automatisation'],
    hiw: {
      pill: 'Comment ça marche',
      title: 'En ligne en',
      title_em: 'moins de 10 min.',
      steps: [
        { title: 'Créez votre compte', desc: 'Essai gratuit, sans carte. Choisissez votre type d’activité — coiffure, coach, bien-être…' },
        { title: 'Définissez vos horaires', desc: 'Glissez votre planning hebdomadaire, ajoutez vos jours de congé, fixez la durée des créneaux.' },
        { title: 'Partagez votre lien', desc: 'Intégrez-le à Instagram, votre site ou imprimez-le. C’est tout.' }
      ]
    },
    tests: {
      pill: 'Témoignages',
      title: 'De vrais',
      title_em: 'professionnels.',
      items: [
        { q: 'Je passais 30 minutes par jour à jongler entre WhatsApp et un carnet papier. Maintenant mes dimanches m’appartiennent à nouveau.', n: 'Léa Bernard', r: 'Coiffeuse · Studio Léa' },
        { q: 'Configuré en 8 minutes. Ma première réservation est arrivée le soir même. Mon taux de présence est passé de 70 % à 95 %.', n: 'Marc Donati', r: 'Coach sportif · Marc Coaching' },
        { q: 'La prise de rendez-vous est le nerf de mon activité. Je ne devrais pas avoir à y penser. Maintenant, je n’y pense plus.', n: 'Iris Vermeer', r: 'Thérapeute Reiki' }
      ]
    },
    pricing: {
      label: 'Tarifs',
      title: 'Gratuit pour toujours. 19 €/mois quand vous grandissez.',
      desc: 'Commencez gratuitement, passez en premium uniquement quand vous avez besoin de réservations illimitées, SMS ou plusieurs employés.',
      cta_1: 'Voir les plans',
      cta_2: 'Commencer gratuitement'
    },
    cta: {
      title: 'Récupérez vos heures.',
      title_em: 'Commencez ce soir.',
      desc: 'Essai Premium 14 jours. Sans carte bancaire. Annulez à tout moment.',
      btn_1: 'Commencer gratuitement →',
      btn_2: 'Nous parler'
    }
  },
  en: {
    hero: {
      badge: 'New · Google Calendar 2-way sync',
      title_1: 'Your bookings.',
      title_2: 'One calm place.',
      cta_secondary: 'See how it works',
      check_1: 'No credit card',
      check_2: 'Free forever plan',
      check_3: 'Cancel any time'
    },
    trust: { label: 'Trusted by 1,200+ independent pros across Europe' },
    stats: [
      { n: '3,200+', l: 'appointments / month', s: 'across our pros' },
      { n: '12 min', l: 'saved per day', s: 'vs. WhatsApp & calls' },
      { n: '98%', l: 'show-up rate', s: 'with SMS reminders' },
      { n: '4.9 ★', l: 'G2 / Capterra', s: 'from 240 reviews' }
    ],
    features: {
      pill: 'Features',
      title: 'Everything you need.',
      title_em: "Nothing you don't.",
      desc: 'We built BranShee by listening to coaches, hairdressers and therapists. The result: a calmer way to run your week.',
      tags: ['Booking', 'Availability', 'Payment', 'Flexibility', 'Customisation', 'Updates']
    },
    func_tags: ['Calendar', 'Booking', 'Automation'],
    hiw: {
      pill: 'How it works',
      title: 'Live in',
      title_em: 'under 10 minutes.',
      steps: [
        { title: 'Create your account', desc: 'Free trial, no card. Choose your service type — hair, coach, wellness…' },
        { title: 'Set your hours', desc: 'Drag your weekly schedule, add days off, set slot duration.' },
        { title: 'Share your link', desc: 'Embed on Instagram, your site, or print it on a card. Done.' }
      ]
    },
    tests: {
      pill: 'Testimonials',
      title: 'From actual',
      title_em: 'pros.',
      items: [
        { q: 'I used to spend 30 minutes a day juggling WhatsApp and a paper book. Now my Sundays are mine again.', n: 'Léa Bernard', r: 'Hair stylist · Studio Léa' },
        { q: 'Set up in 8 minutes. My first booking came in the same evening. Show-ups went from 70% to 95%.', n: 'Marc Donati', r: 'Personal trainer · Marc Coaching' },
        { q: "Booking is the most important thing in my business and I shouldn't have to think about it. Now I don't.", n: 'Iris Vermeer', r: 'Reiki therapist' }
      ]
    },
    pricing: {
      label: 'Pricing',
      title: 'Free forever. €19/mo when you grow.',
      desc: 'Start free, upgrade only when you need unlimited bookings, SMS, or multiple employees.',
      cta_1: 'See plans',
      cta_2: 'Start free trial'
    },
    cta: {
      title: 'Get back the hours.',
      title_em: 'Start tonight.',
      desc: '14-day Premium trial. No credit card required. Cancel any time.',
      btn_1: 'Start free trial →',
      btn_2: 'Talk to us'
    }
  },
  de: {
    hero: {
      badge: 'Neu · Google Kalender 2-Wege-Sync',
      title_1: 'Ihre Buchungen.',
      title_2: 'Ein ruhiger Ort.',
      cta_secondary: 'So funktioniert es',
      check_1: 'Keine Kreditkarte',
      check_2: 'Kostenloser Plan für immer',
      check_3: 'Jederzeit kündigen'
    },
    trust: { label: 'Vertrauen von 1.200+ Selbstständigen in ganz Europa' },
    stats: [
      { n: '3.200+', l: 'Termine / Monat', s: 'bei unseren Profis' },
      { n: '12 Min.', l: 'täglich gespart', s: 'vs. WhatsApp & Anrufe' },
      { n: '98 %', l: 'Erscheinungsrate', s: 'mit SMS-Erinnerungen' },
      { n: '4,9 ★', l: 'G2 / Capterra', s: 'aus 240 Bewertungen' }
    ],
    features: {
      pill: 'Funktionen',
      title: 'Alles, was Sie brauchen.',
      title_em: 'Nichts, was Sie nicht brauchen.',
      desc: 'Wir haben BranShee entwickelt, indem wir Coaches, Friseure und Therapeuten zugehört haben. Das Ergebnis: eine ruhigere Art, Ihre Woche zu managen.',
      tags: ['Buchung', 'Verfügbarkeit', 'Zahlung', 'Flexibilität', 'Anpassung', 'Updates']
    },
    func_tags: ['Kalender', 'Buchung', 'Automatisierung'],
    hiw: {
      pill: 'So funktioniert es',
      title: 'Live in',
      title_em: 'unter 10 Minuten.',
      steps: [
        { title: 'Konto erstellen', desc: 'Kostenlose Testversion, keine Karte. Wählen Sie Ihren Servicetyp — Haare, Coach, Wellness…' },
        { title: 'Zeiten festlegen', desc: 'Ziehen Sie Ihren Wochenplan, fügen Sie freie Tage hinzu, legen Sie die Slotdauer fest.' },
        { title: 'Link teilen', desc: 'Auf Instagram einbetten, auf Ihrer Website oder ausdrucken. Fertig.' }
      ]
    },
    tests: {
      pill: 'Erfahrungsberichte',
      title: 'Von echten',
      title_em: 'Profis.',
      items: [
        { q: 'Ich verbrachte 30 Minuten täglich damit, zwischen WhatsApp und einem Papierbuch zu jonglieren. Jetzt gehören mir meine Sonntage wieder.', n: 'Léa Bernard', r: 'Friseurin · Studio Léa' },
        { q: 'In 8 Minuten eingerichtet. Meine erste Buchung kam am selben Abend. Die Erscheinungsrate stieg von 70 % auf 95 %.', n: 'Marc Donati', r: 'Personal Trainer · Marc Coaching' },
        { q: 'Buchungen sind das Wichtigste in meinem Geschäft und ich sollte nicht darüber nachdenken. Jetzt tue ich es nicht mehr.', n: 'Iris Vermeer', r: 'Reiki-Therapeutin' }
      ]
    },
    pricing: {
      label: 'Preise',
      title: 'Für immer kostenlos. 19 €/Monat wenn Sie wachsen.',
      desc: 'Starten Sie kostenlos, upgraden Sie nur wenn Sie unbegrenzte Buchungen, SMS oder mehrere Mitarbeiter benötigen.',
      cta_1: 'Pläne ansehen',
      cta_2: 'Kostenlose Testversion starten'
    },
    cta: {
      title: 'Holen Sie sich die Stunden zurück.',
      title_em: 'Starten Sie heute Abend.',
      desc: '14-tägige Premium-Testversion. Keine Kreditkarte. Jederzeit kündigen.',
      btn_1: 'Kostenlos starten →',
      btn_2: 'Mit uns sprechen'
    }
  },
  es: {
    hero: {
      badge: 'Nuevo · Sincronización bidireccional Google Calendar',
      title_1: 'Tus reservas.',
      title_2: 'Un lugar tranquilo.',
      cta_secondary: 'Ver cómo funciona',
      check_1: 'Sin tarjeta de crédito',
      check_2: 'Plan gratuito para siempre',
      check_3: 'Cancela cuando quieras'
    },
    trust: { label: 'Con la confianza de más de 1.200 profesionales en Europa' },
    stats: [
      { n: '3.200+', l: 'citas / mes', s: 'entre nuestros profesionales' },
      { n: '12 min', l: 'ahorrados al día', s: 'vs. WhatsApp y llamadas' },
      { n: '98 %', l: 'tasa de asistencia', s: 'con recordatorios SMS' },
      { n: '4,9 ★', l: 'G2 / Capterra', s: 'de 240 reseñas' }
    ],
    features: {
      pill: 'Funcionalidades',
      title: 'Todo lo que necesitas.',
      title_em: 'Nada más.',
      desc: 'Construimos BranShee escuchando a coaches, peluqueros y terapeutas. El resultado: una forma más tranquila de gestionar tu semana.',
      tags: ['Reserva', 'Disponibilidad', 'Pago', 'Flexibilidad', 'Personalización', 'Actualizaciones']
    },
    func_tags: ['Calendario', 'Reserva', 'Automatización'],
    hiw: {
      pill: 'Cómo funciona',
      title: 'En línea en',
      title_em: 'menos de 10 min.',
      steps: [
        { title: 'Crea tu cuenta', desc: 'Prueba gratuita, sin tarjeta. Elige tu tipo de servicio — peluquería, coach, bienestar…' },
        { title: 'Define tus horarios', desc: 'Arrastra tu horario semanal, añade días libres, fija la duración de los turnos.' },
        { title: 'Comparte tu enlace', desc: 'Incórporalo en Instagram, tu web o imprímelo. Listo.' }
      ]
    },
    tests: {
      pill: 'Testimonios',
      title: 'De verdaderos',
      title_em: 'profesionales.',
      items: [
        { q: 'Antes pasaba 30 minutos al día entre WhatsApp y una agenda de papel. Ahora mis domingos son míos.', n: 'Léa Bernard', r: 'Peluquera · Studio Léa' },
        { q: 'Configurado en 8 minutos. Mi primera reserva llegó esa misma tarde. La tasa de asistencia pasó del 70 % al 95 %.', n: 'Marc Donati', r: 'Entrenador personal · Marc Coaching' },
        { q: 'Las reservas son lo más importante en mi negocio y no debería tener que pensar en ello. Ahora no pienso.', n: 'Iris Vermeer', r: 'Terapeuta Reiki' }
      ]
    },
    pricing: {
      label: 'Precios',
      title: 'Gratis para siempre. 19 €/mes cuando crezcas.',
      desc: 'Empieza gratis, actualiza solo cuando necesites reservas ilimitadas, SMS o varios empleados.',
      cta_1: 'Ver planes',
      cta_2: 'Empezar prueba gratuita'
    },
    cta: {
      title: 'Recupera las horas.',
      title_em: 'Empieza esta noche.',
      desc: 'Prueba Premium 14 días. Sin tarjeta de crédito. Cancela cuando quieras.',
      btn_1: 'Empezar gratis →',
      btn_2: 'Hablar con nosotros'
    }
  },
  it: {
    hero: {
      badge: 'Nuovo · Sincronizzazione bidirezionale Google Calendar',
      title_1: 'Le tue prenotazioni.',
      title_2: 'Un posto sereno.',
      cta_secondary: 'Scopri come funziona',
      check_1: 'Senza carta di credito',
      check_2: 'Piano gratuito per sempre',
      check_3: 'Annulla quando vuoi'
    },
    trust: { label: 'Scelto da oltre 1.200 professionisti indipendenti in Europa' },
    stats: [
      { n: '3.200+', l: 'appuntamenti / mese', s: 'dai nostri professionisti' },
      { n: '12 min', l: 'risparmiati al giorno', s: 'vs. WhatsApp & telefonate' },
      { n: '98 %', l: 'tasso di presenza', s: 'con i promemoria SMS' },
      { n: '4,9 ★', l: 'G2 / Capterra', s: 'da 240 recensioni' }
    ],
    features: {
      pill: 'Funzionalità',
      title: 'Tutto quello che ti serve.',
      title_em: 'Niente di superfluo.',
      desc: 'Abbiamo costruito BranShee ascoltando coach, parrucchieri e terapisti. Il risultato: un modo più sereno di gestire la settimana.',
      tags: ['Prenotazione', 'Disponibilità', 'Pagamento', 'Flessibilità', 'Personalizzazione', 'Aggiornamenti']
    },
    func_tags: ['Calendario', 'Prenotazione', 'Automazione'],
    hiw: {
      pill: 'Come funziona',
      title: 'Online in',
      title_em: 'meno di 10 min.',
      steps: [
        { title: 'Crea il tuo account', desc: 'Prova gratuita, senza carta. Scegli il tipo di attività — capelli, coach, benessere…' },
        { title: 'Imposta i tuoi orari', desc: 'Trascina il piano settimanale, aggiungi giorni liberi, imposta la durata degli slot.' },
        { title: 'Condividi il tuo link', desc: 'Incorporalo su Instagram, sul tuo sito o stampalo. Fatto.' }
      ]
    },
    tests: {
      pill: 'Testimonianze',
      title: 'Da veri',
      title_em: 'professionisti.',
      items: [
        { q: 'Passavo 30 minuti al giorno a destreggiarmi tra WhatsApp e un’agenda cartacea. Ora le mie domeniche sono mie.', n: 'Léa Bernard', r: 'Parrucchiera · Studio Léa' },
        { q: 'Configurato in 8 minuti. La mia prima prenotazione è arrivata la stessa sera. Il tasso di presenza è passato dal 70 % al 95 %.', n: 'Marc Donati', r: 'Personal trainer · Marc Coaching' },
        { q: 'Le prenotazioni sono la cosa più importante nella mia attività e non dovrei pensarci. Ora non ci penso più.', n: 'Iris Vermeer', r: 'Terapista Reiki' }
      ]
    },
    pricing: {
      label: 'Prezzi',
      title: 'Gratuito per sempre. 19 €/mese quando cresci.',
      desc: 'Inizia gratis, passa al premium solo quando hai bisogno di prenotazioni illimitate, SMS o più dipendenti.',
      cta_1: 'Vedi i piani',
      cta_2: 'Inizia la prova gratuita'
    },
    cta: {
      title: 'Riprendi le tue ore.',
      title_em: 'Inizia stasera.',
      desc: 'Prova Premium 14 giorni. Senza carta di credito. Annulla quando vuoi.',
      btn_1: 'Inizia gratis →',
      btn_2: 'Parlaci'
    }
  },
  nl: {
    hero: {
      badge: 'Nieuw · Google Agenda 2-weg synchronisatie',
      title_1: 'Uw boekingen.',
      title_2: 'Één rustige plek.',
      cta_secondary: 'Bekijk hoe het werkt',
      check_1: 'Geen creditcard',
      check_2: 'Gratis plan voor altijd',
      check_3: 'Opzeggen wanneer u wilt'
    },
    trust: { label: 'Vertrouwd door 1.200+ zelfstandige professionals in Europa' },
    stats: [
      { n: '3.200+', l: 'afspraken / maand', s: 'bij onze professionals' },
      { n: '12 min', l: 'bespaard per dag', s: 'vs. WhatsApp & bellen' },
      { n: '98 %', l: 'aanwezigheidsrate', s: 'met SMS-herinneringen' },
      { n: '4,9 ★', l: 'G2 / Capterra', s: 'van 240 beoordelingen' }
    ],
    features: {
      pill: 'Functies',
      title: 'Alles wat u nodig heeft.',
      title_em: 'Niets wat u niet nodig heeft.',
      desc: 'We hebben BranShee gebouwd door te luisteren naar coaches, kappers en therapeuten. Het resultaat: een rustiger manier om uw week te beheren.',
      tags: ['Boeking', 'Beschikbaarheid', 'Betaling', 'Flexibiliteit', 'Aanpassing', 'Updates']
    },
    func_tags: ['Agenda', 'Boeking', 'Automatisering'],
    hiw: {
      pill: 'Hoe het werkt',
      title: 'Live in',
      title_em: 'minder dan 10 min.',
      steps: [
        { title: 'Maak uw account aan', desc: 'Gratis proefperiode, geen kaart. Kies uw servicetype — haar, coach, wellness…' },
        { title: 'Stel uw uren in', desc: 'Sleep uw weekschema, voeg vrije dagen toe, stel de slotduur in.' },
        { title: 'Deel uw link', desc: 'Embed op Instagram, uw website of druk het af. Klaar.' }
      ]
    },
    tests: {
      pill: 'Getuigenissen',
      title: 'Van echte',
      title_em: 'professionals.',
      items: [
        { q: 'Ik besteedde 30 minuten per dag aan WhatsApp en een papieren agenda. Nu zijn mijn zondagen van mij.', n: 'Léa Bernard', r: 'Kapper · Studio Léa' },
        { q: 'In 8 minuten opgezet. Mijn eerste boeking kwam diezelfde avond. De aanwezigheidsrate steeg van 70 % naar 95 %.', n: 'Marc Donati', r: 'Personal trainer · Marc Coaching' },
        { q: 'Boekingen zijn het belangrijkste in mijn bedrijf en ik hoef er niet over na te denken. Nu doe ik dat niet meer.', n: 'Iris Vermeer', r: 'Reiki therapeut' }
      ]
    },
    pricing: {
      label: 'Prijzen',
      title: 'Voor altijd gratis. €19/maand als u groeit.',
      desc: 'Start gratis, upgrade alleen wanneer u onbeperkte boekingen, SMS of meerdere medewerkers nodig heeft.',
      cta_1: 'Bekijk plannen',
      cta_2: 'Start gratis proefperiode'
    },
    cta: {
      title: 'Haal de uren terug.',
      title_em: 'Begin vanavond.',
      desc: '14-daagse Premium proefperiode. Geen creditcard vereist. Opzeggen wanneer u wilt.',
      btn_1: 'Gratis beginnen →',
      btn_2: 'Praat met ons'
    }
  }
};

const langs = ['fr', 'en', 'de', 'es', 'it', 'nl'];
langs.forEach(lang => {
  const file = path.join(__dirname, '..', 'locales', lang + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.pro_landing = translations[lang];
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log('OK ' + lang + '.json');
});
