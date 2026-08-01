const SERVICES = {
  fr: [
    // Santé & Médecine
    "Médecin généraliste", "Médecin spécialiste", "Pédiatre", "Gynécologue", "Cardiologue",
    "Dermatologue", "Ophtalmologue", "ORL", "Réflexologue", "Psychiatre", "Dentiste",
    "Orthodontiste", "Chirurgien dentiste", "Kinésithérapeute", "Ostéopathe", "Chiropracteur",
    "Psychologue", "Psychothérapeute", "Infirmier / Infirmière", "Sage-femme", "Podologue",
    "Orthophoniste", "Orthoptiste", "Opticien", "Diététicien / Nutritionniste", "Acupuncteur",
    "Naturopathe", "Homéopathe", "Sophrologue", "Hypnothérapeute", "Ergothérapeute",
    "Psychomotricien", "Neurologue", "Rhumatologue", "Gastroentérologue", "Endocrinologue",
    "Angiologue", "Chirurgien", "Radiologue", "Urologue", "Pneumologue", "Oncologue",
    "Allergologue", "Médecin du sport", "Médecin esthétique", "Sexologue", "Gériatre",
    // Beauté & Bien-être
    "Coiffeur / Coiffeuse", "Barbier", "Esthéticienne", "Manucure / Prothésiste ongulaire",
    "Pédicure", "Maquilleur / Maquilleuse", "Tatoueur / Tatoueuse", "Pierceur",
    "Masseur / Masseuse", "Spa & Centre de bien-être", "Institut de beauté",
    "Centre d'épilation laser", "Microblading & Sourcils", "Extension de cils", "Bronzage UV",
    // Sport & Fitness
    "Coach sportif / Personal trainer", "Salle de sport", "Professeur de yoga",
    "Professeur de pilates", "Professeur de danse", "Professeur de natation",
    "Professeur d'arts martiaux", "Professeur de boxe", "Professeur de tennis",
    "Professeur de golf", "Préparateur physique", "Professeur de crossfit",
    // Automobile & Mécanique
    "Garagiste / Mécanicien auto", "Carrossier", "Contrôle technique",
    "Électricien automobile", "Pneumaticien", "Mécanicien moto",
    "Detailing / Lavage de voiture",
    // Bâtiment & Habitat
    "Architecte", "Décorateur d'intérieur", "Électricien", "Plombier", "Charpentier",
    "Menuisier", "Peintre en bâtiment", "Maçon", "Serrurier", "Vitrier",
    "Jardinier / Paysagiste", "Carreleur", "Chauffagiste", "Climaticien",
    // Juridique & Finance
    "Avocat", "Notaire", "Expert-comptable", "Conseiller financier",
    "Gestionnaire de patrimoine", "Huissier de justice", "Médiateur", "Conseiller juridique",
    // Conseil & Coaching
    "Coach de vie / Life coach", "Coach business", "Consultant", "Consultant RH",
    "Consultant marketing", "Formateur professionnel", "Thérapeute de couple",
    "Conseiller en orientation",
    // Éducation & Formation
    "Professeur particulier", "Tuteur", "Professeur de musique", "Professeur de piano",
    "Professeur de guitare", "Professeur de langues", "Auto-école",
    // Animaux
    "Vétérinaire", "Toiletteur pour animaux", "Éducateur canin", "Pet sitter",
    // Photo & Événementiel
    "Photographe", "Vidéaste", "DJ", "Traiteur", "Organisateur d'événements",
    "Wedding planner", "Animateur / Magicien",
    // IT & Tech
    "Développeur freelance", "Consultant IT", "Réparateur informatique",
    "Réparateur de téléphone", "Designer graphique", "Designer UX/UI",
    // Immobilier
    "Agent immobilier", "Gestionnaire de biens", "Chasseur immobilier",
    // Services à la personne
    "Aide à domicile", "Baby-sitter", "Garde d'enfants", "Auxiliaire de vie", "Aide-soignant",
    // Autre
    "Autre",
  ],
  en: [
    // Health & Medicine
    "General practitioner", "Specialist doctor", "Pediatrician", "Gynecologist", "Cardiologist",
    "Dermatologist", "Ophthalmologist", "ENT specialist", "Reflexologist", "Psychiatrist",
    "Dentist", "Orthodontist", "Dental surgeon", "Physiotherapist", "Osteopath", "Chiropractor",
    "Psychologist", "Psychotherapist", "Nurse", "Midwife", "Podiatrist", "Speech therapist",
    "Orthoptist", "Optician", "Dietitian / Nutritionist", "Acupuncturist", "Naturopath",
    "Homeopath", "Sophrologist", "Hypnotherapist", "Occupational therapist",
    "Psychomotor therapist", "Neurologist", "Rheumatologist", "Gastroenterologist",
    "Endocrinologist", "Angiologist", "Surgeon", "Radiologist", "Urologist", "Pulmonologist",
    "Oncologist", "Allergist", "Sports doctor", "Aesthetic doctor", "Sexologist", "Geriatrician",
    // Beauty & Wellness
    "Hairdresser", "Barber", "Beautician", "Nail technician", "Pedicure", "Make-up artist",
    "Tattoo artist", "Piercer", "Masseur / Masseuse", "Spa & Wellness center",
    "Beauty institute", "Laser hair removal center", "Microblading & Eyebrows",
    "Eyelash extensions", "UV tanning",
    // Sport & Fitness
    "Personal trainer", "Gym", "Yoga instructor", "Pilates instructor", "Dance teacher",
    "Swimming instructor", "Martial arts instructor", "Boxing coach", "Tennis coach",
    "Golf coach", "Physical trainer", "CrossFit coach",
    // Automotive & Mechanics
    "Garage / Car mechanic", "Body repair shop", "Vehicle inspection", "Auto electrician",
    "Tire specialist", "Motorcycle mechanic", "Car detailing / Car wash",
    // Construction & Home
    "Architect", "Interior designer", "Electrician", "Plumber", "Carpenter", "Joiner",
    "Painter", "Mason", "Locksmith", "Glazier", "Gardener / Landscaper", "Tiler",
    "Heating engineer", "Air conditioning engineer",
    // Legal & Finance
    "Lawyer", "Notary", "Accountant", "Financial advisor", "Wealth manager",
    "Bailiff", "Mediator", "Legal advisor",
    // Consulting & Coaching
    "Life coach", "Business coach", "Consultant", "HR consultant", "Marketing consultant",
    "Professional trainer", "Couples therapist", "Career counselor",
    // Education & Training
    "Private tutor", "Tutor", "Music teacher", "Piano teacher", "Guitar teacher",
    "Language teacher", "Driving school",
    // Animals
    "Veterinarian", "Pet groomer", "Dog trainer", "Pet sitter",
    // Photo & Events
    "Photographer", "Videographer", "DJ", "Caterer", "Event organizer",
    "Wedding planner", "Entertainer / Magician",
    // IT & Tech
    "Freelance developer", "IT consultant", "Computer repair", "Phone repair",
    "Graphic designer", "UX/UI designer",
    // Real Estate
    "Real estate agent", "Property manager", "Property hunter",
    // Personal services
    "Home help", "Babysitter", "Childminder", "Care assistant", "Nursing aide",
    // Other
    "Other",
  ],
  nl: [
    // Gezondheid & Geneeskunde
    "Huisarts", "Specialist", "Kinderarts", "Gynaecoloog", "Cardioloog", "Dermatoloog",
    "Oogarts", "KNO-arts", "Reflexoloog", "Psychiater", "Tandarts", "Orthodontist",
    "Kaakchirurg", "Kinesitherapeut", "Osteopaat", "Chiropractor", "Psycholoog",
    "Psychotherapeut", "Verpleegkundige", "Vroedvrouw", "Podoloog", "Logopedist",
    "Orthoptist", "Opticien", "Diëtist / Nutritionist", "Acupuncturist", "Naturopaath",
    "Homeopaat", "Sofroloog", "Hypnotherapeut", "Ergotherapeut", "Psychomotorisch therapeut",
    "Neuroloog", "Reumatoloog", "Gastro-enteroloog", "Endocrinoloog", "Angioloog",
    "Chirurg", "Radioloog", "Uroloog", "Longarts", "Oncoloog", "Allergoloog", "Sportarts",
    "Esthetisch arts", "Seksuoloog", "Geriater",
    // Schoonheid & Welzijn
    "Kapper", "Barbier", "Schoonheidsspecialiste", "Nageltechnicus", "Pedicure",
    "Visagist", "Tattoo-artist", "Piercingspecialist", "Masseur / Masseuse",
    "Spa & Wellnesscentrum", "Schoonheidsinstituut", "Laserhaarverwijdering",
    "Microblading & Wenkbrauwen", "Wimperextensions", "UV-bruining",
    // Sport & Fitness
    "Personal trainer", "Sportschool", "Yoga-instructeur", "Pilates-instructeur",
    "Dansdocent", "Zwemdocent", "Vechtsporten instructeur", "Bokstrainer", "Tenniscoach",
    "Golfcoach", "Fysieke trainer", "CrossFit-coach",
    // Auto & Mechanica
    "Garagist / Automonteur", "Carrosseriebedrijf", "APK-keuring", "Auto-elektricien",
    "Bandenmonteur", "Motorfietsmonteur", "Autodetailing / Autowassen",
    // Bouw & Woning
    "Architect", "Interieurdesigner", "Elektricien", "Loodgieter", "Timmerman",
    "Schrijnwerker", "Schilder", "Metselaar", "Slotenmaker", "Glazenier",
    "Hovenier / Landschapsarchitect", "Tegelzetter", "Verwarmingstechnicus", "Airconditioningtechnicus",
    // Juridisch & Financieel
    "Advocaat", "Notaris", "Accountant", "Financieel adviseur", "Vermogensbeheerder",
    "Deurwaarder", "Bemiddelaar", "Juridisch adviseur",
    // Advies & Coaching
    "Lifecoach", "Businesscoach", "Consultant", "HR-consultant", "Marketingconsultant",
    "Professionele trainer", "Relatietherapeut", "Loopbaanbegeleider",
    // Onderwijs & Opleiding
    "Privéleraar", "Tutor", "Muziekleraar", "Pianoleraar", "Gitaarleraar",
    "Taalleraar", "Rijschool",
    // Dieren
    "Dierenarts", "Trimsalon", "Hondentrainer", "Huisdieroppasser",
    // Foto & Evenementen
    "Fotograaf", "Videograaf", "DJ", "Cateraar", "Evenementenorganisator",
    "Weddingplanner", "Entertainer / Goochelaar",
    // IT & Tech
    "Freelance ontwikkelaar", "IT-consultant", "Computerherstel", "Telefoonherstel",
    "Grafisch ontwerper", "UX/UI-ontwerper",
    // Vastgoed
    "Makelaar", "Vastgoedbeheerder", "Vastgoedzoeker",
    // Persoonlijke diensten
    "Thuishulp", "Babysitter", "Kinderoppasser", "Verzorgingsassistent", "Verpleegkundige assistent",
    // Overige
    "Overige",
  ],
  de: [
    // Gesundheit & Medizin
    "Hausarzt", "Facharzt", "Kinderarzt", "Gynäkologe", "Kardiologe", "Dermatologe",
    "Augenarzt", "HNO-Arzt", "Reflexologe", "Psychiater", "Zahnarzt", "Kieferorthopäde",
    "Kieferchirurg", "Physiotherapeut", "Osteopath", "Chiropraktiker", "Psychologe",
    "Psychotherapeut", "Krankenpfleger / Krankenschwester", "Hebamme", "Podologe",
    "Logopäde", "Orthoptist", "Optiker", "Ernährungsberater", "Akupunkteur", "Naturheilkundler",
    "Homöopath", "Sophrologe", "Hypnotherapeut", "Ergotherapeut", "Psychomotoriker",
    "Neurologe", "Rheumatologe", "Gastroenterologe", "Endokrinologe", "Angiologe",
    "Chirurg", "Radiologe", "Urologe", "Pneumologe", "Onkologe", "Allergologe",
    "Sportarzt", "Ästhetischer Arzt", "Sexologe", "Geriater",
    // Schönheit & Wohlbefinden
    "Friseur / Friseurin", "Barbier", "Kosmetikerin", "Nageldesignerin", "Pediküre",
    "Maskenbildner / Maskenbildnerin", "Tätowierer / Tätowiererin", "Piercingspezialist",
    "Masseur / Masseurin", "Spa & Wellnesscenter", "Schönheitsinstitut",
    "Laser-Haarentfernung", "Microblading & Augenbrauen", "Wimpernverlängerung", "UV-Bräunung",
    // Sport & Fitness
    "Personal Trainer", "Fitnessstudio", "Yoga-Lehrer", "Pilates-Lehrer", "Tanzlehrer",
    "Schwimmlehrer", "Kampfsportlehrer", "Boxtrainer", "Tennistrainer",
    "Golftrainer", "Konditionstrainer", "CrossFit-Trainer",
    // Automobil & Mechanik
    "Automechaniker", "Karosseriebauer", "Hauptuntersuchung", "Kfz-Elektriker",
    "Reifenservice", "Motorradmechaniker", "Fahrzeugdetailing / Autowäsche",
    // Bau & Wohnen
    "Architekt", "Innenarchitekt", "Elektriker", "Klempner", "Zimmermann",
    "Tischler", "Maler", "Maurer", "Schlosser", "Glaser",
    "Gärtner / Landschaftsgärtner", "Fliesenleger", "Heizungstechniker", "Klimatechniker",
    // Recht & Finanzen
    "Rechtsanwalt", "Notar", "Steuerberater", "Finanzberater", "Vermögensverwalter",
    "Gerichtsvollzieher", "Mediator", "Rechtsberater",
    // Beratung & Coaching
    "Life Coach", "Business Coach", "Berater", "HR-Berater", "Marketing-Berater",
    "Berufsausbilder", "Paartherapeut", "Karriereberater",
    // Bildung & Ausbildung
    "Nachhilfelehrer", "Tutor", "Musiklehrer", "Klavierlehrer", "Gitarrenlehrer",
    "Sprachlehrer", "Fahrschule",
    // Tiere
    "Tierarzt", "Tierpfleger", "Hundetrainer", "Tiersitter",
    // Foto & Events
    "Fotograf", "Videograf", "DJ", "Caterer", "Eventorganisator",
    "Hochzeitsplaner", "Entertainer / Zauberer",
    // IT & Tech
    "Freiberuflicher Entwickler", "IT-Berater", "Computerreparatur", "Handyreparatur",
    "Grafikdesigner", "UX/UI-Designer",
    // Immobilien
    "Immobilienmakler", "Immobilienverwalter", "Immobilienjäger",
    // Persönliche Dienstleistungen
    "Haushaltshilfe", "Babysitter", "Kinderbetreuung", "Pflegeassistent", "Pflegehelfer",
    // Sonstiges
    "Sonstiges",
  ],
  es: [
    // Salud & Medicina
    "Médico de familia", "Médico especialista", "Pediatra", "Ginecólogo", "Cardiólogo",
    "Dermatólogo", "Oftalmólogo", "Otorrinolaringólogo", "Reflexólogo", "Psiquiatra",
    "Dentista", "Ortodoncista", "Cirujano dental", "Fisioterapeuta", "Osteópata",
    "Quiropráctico", "Psicólogo", "Psicoterapeuta", "Enfermero / Enfermera", "Matrona",
    "Podólogo", "Logopeda", "Ortoptista", "Óptico", "Dietista / Nutricionista",
    "Acupunturista", "Naturópata", "Homeópata", "Sofrólogo", "Hipnoterapeuta",
    "Terapeuta ocupacional", "Psicomotricista", "Neurólogo", "Reumatólogo",
    "Gastroenterólogo", "Endocrinólogo", "Angiólogo", "Cirujano", "Radiólogo",
    "Urólogo", "Neumólogo", "Oncólogo", "Alergólogo", "Médico deportivo",
    "Médico estético", "Sexólogo", "Geriatra",
    // Belleza & Bienestar
    "Peluquero / Peluquera", "Barbero", "Esteticista", "Técnico en uñas", "Pedicura",
    "Maquillador / Maquilladora", "Tatuador / Tatuadora", "Piercing", "Masajista",
    "Spa & Centro de bienestar", "Instituto de belleza", "Centro de depilación láser",
    "Microblading & Cejas", "Extensiones de pestañas", "Bronceado UV",
    // Deporte & Fitness
    "Entrenador personal", "Gimnasio", "Profesor de yoga", "Profesor de pilates",
    "Profesor de danza", "Profesor de natación", "Profesor de artes marciales",
    "Entrenador de boxeo", "Entrenador de tenis", "Entrenador de golf",
    "Preparador físico", "Entrenador de CrossFit",
    // Automoción & Mecánica
    "Mecánico / Taller", "Chapista", "Inspección técnica", "Electricista de vehículos",
    "Especialista en neumáticos", "Mecánico de motos", "Detailing / Lavado de coches",
    // Construcción & Hogar
    "Arquitecto", "Diseñador de interiores", "Electricista", "Fontanero", "Carpintero",
    "Ebanista", "Pintor", "Albañil", "Cerrajero", "Cristalero",
    "Jardinero / Paisajista", "Alicatador", "Técnico de calefacción", "Técnico de climatización",
    // Jurídico & Finanzas
    "Abogado", "Notario", "Asesor fiscal", "Asesor financiero", "Gestor de patrimonio",
    "Procurador", "Mediador", "Asesor jurídico",
    // Consultoría & Coaching
    "Coach de vida", "Coach empresarial", "Consultor", "Consultor de RRHH",
    "Consultor de marketing", "Formador profesional", "Terapeuta de pareja", "Orientador laboral",
    // Educación & Formación
    "Profesor particular", "Tutor", "Profesor de música", "Profesor de piano",
    "Profesor de guitarra", "Profesor de idiomas", "Autoescuela",
    // Animales
    "Veterinario", "Peluquero de animales", "Adiestrador canino", "Cuidador de mascotas",
    // Foto & Eventos
    "Fotógrafo", "Videógrafo", "DJ", "Catering", "Organizador de eventos",
    "Wedding planner", "Animador / Mago",
    // IT & Tech
    "Desarrollador freelance", "Consultor IT", "Reparación de ordenadores",
    "Reparación de móviles", "Diseñador gráfico", "Diseñador UX/UI",
    // Inmobiliaria
    "Agente inmobiliario", "Administrador de fincas", "Buscador de propiedades",
    // Servicios a domicilio
    "Asistente del hogar", "Canguro", "Cuidador de niños", "Auxiliar de cuidados", "Auxiliar de enfermería",
    // Otro
    "Otro",
  ],
  it: [
    // Salute & Medicina
    "Medico di base", "Medico specialista", "Pediatra", "Ginecologo", "Cardiologo",
    "Dermatologo", "Oftalmologo", "Otorinolaringoiatra", "Riflessologo", "Psichiatra",
    "Dentista", "Ortodontista", "Chirurgo dentale", "Fisioterapista", "Osteopata",
    "Chiropratico", "Psicologo", "Psicoterapeuta", "Infermiere / Infermiera", "Ostetrica",
    "Podologo", "Logopedista", "Ortottista", "Ottico", "Dietista / Nutrizionista",
    "Agopuntore", "Naturopata", "Omeopata", "Sofrologo", "Ipnoterapeuta",
    "Terapista occupazionale", "Psicomotricista", "Neurologo", "Reumatologo",
    "Gastroenterologo", "Endocrinologo", "Angiologo", "Chirurgo", "Radiologo",
    "Urologo", "Pneumologo", "Oncologo", "Allergologo", "Medico sportivo",
    "Medico estetico", "Sessuologo", "Geriatra",
    // Bellezza & Benessere
    "Parrucchiere / Parrucchiera", "Barbiere", "Estetista", "Tecnico unghie", "Pedicure",
    "Truccatore / Truccatrice", "Tatuatore / Tatuatrice", "Piercing", "Massaggiatore / Massaggiatrice",
    "Spa & Centro benessere", "Istituto di bellezza", "Centro epilazione laser",
    "Microblading & Sopracciglia", "Extension ciglia", "Abbronzatura UV",
    // Sport & Fitness
    "Personal trainer", "Palestra", "Insegnante di yoga", "Insegnante di pilates",
    "Insegnante di danza", "Insegnante di nuoto", "Insegnante di arti marziali",
    "Allenatore di boxe", "Allenatore di tennis", "Allenatore di golf",
    "Preparatore atletico", "Allenatore CrossFit",
    // Automotive & Meccanica
    "Meccanico / Autofficina", "Carrozziere", "Revisione veicolo", "Elettrauto",
    "Gommista", "Meccanico moto", "Detailing / Lavaggio auto",
    // Edilizia & Casa
    "Architetto", "Designer d'interni", "Elettricista", "Idraulico", "Falegname",
    "Ebanista", "Imbianchino", "Muratore", "Fabbro", "Vetraio",
    "Giardiniere / Paesaggista", "Piastrellista", "Tecnico riscaldamento", "Tecnico climatizzazione",
    // Legale & Finanza
    "Avvocato", "Notaio", "Commercialista", "Consulente finanziario", "Gestore patrimoniale",
    "Ufficiale giudiziario", "Mediatore", "Consulente legale",
    // Consulenza & Coaching
    "Life coach", "Business coach", "Consulente", "Consulente HR", "Consulente marketing",
    "Formatore professionale", "Terapeuta di coppia", "Orientatore professionale",
    // Istruzione & Formazione
    "Insegnante privato", "Tutor", "Insegnante di musica", "Insegnante di pianoforte",
    "Insegnante di chitarra", "Insegnante di lingue", "Autoscuola",
    // Animali
    "Veterinario", "Toelettatore", "Addestratore cinofilo", "Pet sitter",
    // Foto & Eventi
    "Fotografo", "Videomaker", "DJ", "Catering", "Organizzatore eventi",
    "Wedding planner", "Animatore / Mago",
    // IT & Tech
    "Sviluppatore freelance", "Consulente IT", "Riparazione computer",
    "Riparazione cellulare", "Grafico", "Designer UX/UI",
    // Immobiliare
    "Agente immobiliare", "Amministratore di condominio", "Cacciatore di immobili",
    // Servizi alla persona
    "Assistente familiare", "Babysitter", "Baby-sitter", "Assistente di cura", "Infermiere ausiliario",
    // Altro
    "Altro",
  ],
};

/**
 * Get services list for a given language code.
 * Falls back to French if the language is not supported.
 * @param {string} lang - Language code (fr, en, nl, de, es, it)
 * @returns {string[]}
 */
function getServices(lang) {
  return SERVICES[lang] || SERVICES.fr;
}

module.exports = getServices;

// ── Métiers validés par le superadmin ───────────────────────────────────────
// La liste ci-dessus est figée dans le code. Les métiers approuvés depuis la
// page de modération vivent en base : on les tient dans un cache mémoire pour
// que `getServices()` reste SYNCHRONE — il est appelé depuis des dizaines de
// vues et de contrôleurs, le rendre asynchrone casserait tout.
//
// Le cache est rempli au démarrage puis rafraîchi après chaque décision.
let APPROVED = [];

async function refreshApprovedJobTitles() {
  try {
    const JobTitle = require("../db/models/jobTitle.model");
    const rows = await JobTitle.find({ status: "approved" }).select("name").lean();
    APPROVED = rows.map((r) => r.name).filter(Boolean);
  } catch (e) {
    // Base indisponible : on garde le cache précédent plutôt que de vider la
    // liste — un métier validé ne doit pas redevenir « non reconnu ».
  }
  return APPROVED;
}

function getApprovedJobTitles() {
  return APPROVED;
}

// getServices renvoie desormais la liste figee + les metiers valides.
const _baseGetServices = getServices;
function getServicesWithApproved(lang) {
  const base = _baseGetServices(lang);
  if (!APPROVED.length) return base;
  // Pas de doublon si le metier existait deja dans la liste figee.
  const vus = new Set(base.map((s) => s.toLowerCase()));
  return base.concat(APPROVED.filter((n) => !vus.has(String(n).toLowerCase())));
}

module.exports = getServicesWithApproved;
module.exports.refreshApprovedJobTitles = refreshApprovedJobTitles;
module.exports.getApprovedJobTitles = getApprovedJobTitles;
