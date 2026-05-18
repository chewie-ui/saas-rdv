const fs = require('fs');
const path = require('path');

const base = 'C:/Users/quent/Documents/saas-rdv/locales/';

const changes = {
  fr: {
    trust: 'Premiers professionnels à nous faire confiance',
    stats: [
      { n: '< 10 min', l: 'pour être en ligne', s: 'agenda + services configurés' },
      { n: '0 appel', l: 'nécessaire pour réserver', s: 'vos clients réservent seuls' },
      { n: '24 / 7', l: 'réservations automatiques', s: 'même quand vous dormez' },
      { n: '100 %', l: 'gratuit pour commencer', s: 'sans carte bancaire' }
    ],
    plan2features: ["Réservations illimitées","Rappels email automatiques 24h avant","Page personnalisable (logo & couleurs)","Jusqu'à 2 employés","Jusqu'à 10 services","3 questions de formulaire client","Synchronisation Google Calendar","Support prioritaire"],
    plan2missing: ["URL personnalisée (branshee.com/votre-nom)","Jusqu'à 10 employés & 50 services","Emails sans branding BranShee","Statistiques & analytiques avancées"],
    plan3features: ["Tout ce qu'inclut Pro","Jusqu'à 10 employés & 50 services","URL personnalisée incluse (branshee.com/votre-nom)","10 questions de formulaire client","Emails sans branding BranShee","Statistiques & analytiques avancées","Support dédié"]
  },
  en: {
    trust: 'First professionals to trust us',
    stats: [
      { n: '< 10 min', l: 'to go live', s: 'agenda + services configured' },
      { n: '0 call', l: 'needed to book', s: 'clients book themselves' },
      { n: '24 / 7', l: 'automatic bookings', s: 'even while you sleep' },
      { n: '100 %', l: 'free to start', s: 'no credit card needed' }
    ],
    plan2features: ["Unlimited bookings","Automatic email reminders 24h before","Customizable booking page (logo & colors)","Up to 2 employees","Up to 10 services","3 custom client form questions","Google Calendar sync","Priority support"],
    plan2missing: ["Custom URL (branshee.com/your-name)","Up to 10 employees & 50 services","Emails without BranShee branding","Advanced analytics & statistics"],
    plan3features: ["Everything in Pro","Up to 10 employees & 50 services","Custom URL included (branshee.com/your-name)","10 client form questions","Emails without BranShee branding","Advanced analytics & statistics","Dedicated support"]
  },
  nl: {
    trust: 'Eerste professionals die ons vertrouwen',
    stats: [
      { n: '< 10 min', l: 'om live te gaan', s: 'agenda + diensten geconfigureerd' },
      { n: '0 oproep', l: 'nodig om te boeken', s: 'klanten boeken zelf' },
      { n: '24 / 7', l: 'automatische boekingen', s: 'ook terwijl u slaapt' },
      { n: '100 %', l: 'gratis te starten', s: 'geen creditcard nodig' }
    ],
    plan2features: ["Onbeperkte boekingen","Automatische e-mailherinneringen 24u op voorhand","Aanpasbare boekingspagina (logo & kleuren)","Tot 2 medewerkers","Tot 10 diensten","3 vragen in klantformulier","Google Calendar synchronisatie","Prioritaire ondersteuning"],
    plan2missing: ["Aangepaste URL (branshee.com/uw-naam)","Tot 10 medewerkers & 50 diensten","E-mails zonder BranShee-branding","Geavanceerde statistieken & analyses"],
    plan3features: ["Alles van Pro","Tot 10 medewerkers & 50 diensten","Aangepaste URL inbegrepen (branshee.com/uw-naam)","10 vragen in klantformulier","E-mails zonder BranShee-branding","Geavanceerde statistieken & analyses","Toegewezen ondersteuning"]
  },
  de: {
    trust: 'Erste Profis, die uns vertrauen',
    stats: [
      { n: '< 10 min', l: 'um online zu gehen', s: 'Kalender + Dienste konfiguriert' },
      { n: '0 Anruf', l: 'zum Buchen nötig', s: 'Kunden buchen selbst' },
      { n: '24 / 7', l: 'automatische Buchungen', s: 'auch während Sie schlafen' },
      { n: '100 %', l: 'kostenlos starten', s: 'keine Kreditkarte nötig' }
    ],
    plan2features: ["Unbegrenzte Buchungen","Automatische E-Mail-Erinnerungen 24h vorher","Anpassbare Buchungsseite (Logo & Farben)","Bis zu 2 Mitarbeiter","Bis zu 10 Leistungen","3 Fragen im Kundenformular","Google Kalender Synchronisierung","Prioritäts-Support"],
    plan2missing: ["Persönliche URL (branshee.com/ihr-name)","Bis zu 10 Mitarbeiter & 50 Leistungen","E-Mails ohne BranShee-Branding","Erweiterte Statistiken & Analysen"],
    plan3features: ["Alles aus Pro","Bis zu 10 Mitarbeiter & 50 Leistungen","Persönliche URL inklusive (branshee.com/ihr-name)","10 Fragen im Kundenformular","E-Mails ohne BranShee-Branding","Erweiterte Statistiken & Analysen","Dedizierter Support"]
  },
  es: {
    trust: 'Primeros profesionales que confían en nosotros',
    stats: [
      { n: '< 10 min', l: 'para estar en línea', s: 'agenda + servicios configurados' },
      { n: '0 llamada', l: 'necesaria para reservar', s: 'los clientes reservan solos' },
      { n: '24 / 7', l: 'reservas automáticas', s: 'incluso mientras duermes' },
      { n: '100 %', l: 'gratis para empezar', s: 'sin tarjeta bancaria' }
    ],
    plan2features: ["Reservas ilimitadas","Recordatorios automáticos 24h antes","Página personalizable (logo y colores)","Hasta 2 empleados","Hasta 10 servicios","3 preguntas en formulario de cliente","Sincronización Google Calendar","Soporte prioritario"],
    plan2missing: ["URL personalizada (branshee.com/tu-nombre)","Hasta 10 empleados y 50 servicios","Emails sin branding BranShee","Estadísticas y análisis avanzados"],
    plan3features: ["Todo lo de Pro","Hasta 10 empleados y 50 servicios","URL personalizada incluida (branshee.com/tu-nombre)","10 preguntas en formulario de cliente","Emails sin branding BranShee","Estadísticas y análisis avanzados","Soporte dedicado"]
  },
  it: {
    trust: 'Primi professionisti a fidarsi di noi',
    stats: [
      { n: '< 10 min', l: 'per andare online', s: 'agenda + servizi configurati' },
      { n: '0 chiamata', l: 'necessaria per prenotare', s: 'i clienti prenotano da soli' },
      { n: '24 / 7', l: 'prenotazioni automatiche', s: 'anche mentre dormi' },
      { n: '100 %', l: 'gratis per iniziare', s: 'senza carta di credito' }
    ],
    plan2features: ["Prenotazioni illimitate","Promemoria email automatici 24h prima","Pagina personalizzabile (logo e colori)","Fino a 2 dipendenti","Fino a 10 servizi","3 domande nel modulo cliente","Sincronizzazione Google Calendar","Supporto prioritario"],
    plan2missing: ["URL personalizzato (branshee.com/il-tuo-nome)","Fino a 10 dipendenti e 50 servizi","Email senza branding BranShee","Statistiche e analisi avanzate"],
    plan3features: ["Tutto ciò che include Pro","Fino a 10 dipendenti e 50 servizi","URL personalizzato incluso (branshee.com/il-tuo-nome)","10 domande nel modulo cliente","Email senza branding BranShee","Statistiche e analisi avanzate","Supporto dedicato"]
  }
};

let ok = 0, fail = 0;
Object.entries(changes).forEach(([lang, c]) => {
  const filePath = base + lang + '.json';
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.pro) {
      data.pro.trust = { label: c.trust };
      data.pro.stats = c.stats;
    }
    if (data.subscription) {
      data.subscription.plan_2_features = c.plan2features;
      data.subscription.plan_2_missing  = c.plan2missing;
      data.subscription.plan_3_features = c.plan3features;
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(lang + ': OK');
    ok++;
  } catch(e) {
    console.error(lang + ': FAIL - ' + e.message);
    fail++;
  }
});
console.log('Total: ' + ok + ' OK, ' + fail + ' failed');
