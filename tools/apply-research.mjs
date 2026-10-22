// Applica la ricerca ott-2026 alle schede. Formato: id:[tel,sito,prezzo,stagione,fonte,note]
// null = non pubblicato / invariato. Mai inventare: i buchi restano onesti e contattabili.
import { readFileSync, writeFileSync } from 'fs';

const R = {
'cam-01': ['+39 328 6583968', 'https://www.sostacampercaserta.it/', '30–50€/notte per lunghezza (fino a 8 m €30; 8–9 m €40; oltre 9 m €50; giornaliera €15)', "tutto l'anno", 'https://www.sostacampercaserta.it/prezzi/', null],
'cam-02': ['+39 329 1003808', 'https://www.laghiandaia.info/home/', 'tariffa su richiesta', "tutto l'anno", 'https://www.laghiandaia.info/home/', null],
'cam-03': ['+39 339 3030552', 'https://sostacampernapoli.com/', '€35/giorno (diurno €20, notturno €25, service €5)', 'dal primo giovedì di febbraio al 10 gennaio', 'https://sostacampernapoli.com/', null],
'cam-04': ['+39 347 0312747', 'https://www.castagnaroparking.it/', 'da €18/notte (2 persone)', "tutto l'anno", 'https://www.campercontact.com/it/italia/campania/pozzuoli/5116/castagnaro-parking', null],
'cam-05': ['+39 081 8545334', 'http://www.parcofondidibaia.it', '€20/equipaggio', null, 'https://www.geniuscamping.com/tutti-i-campeggi/listing/azienda-agricola-parco-naturale-fondi-di-baia-na', '36 posti, base Ischia/Procida; sito ufficiale non raggiungibile al 22/10/2026'],
'cam-06': ['+39 333 3915349', null, '€10/24h', null, 'https://camperweb.it/area-sosta/bacoli-napoli-bacoli-parking-area-camper/', 'Via Guardascione 56; segnalata chiusura per lavori dal 2021 — chiamare prima'],
'cam-07': ['+39 081 8584497', 'https://www.villajuliapompei.com/', 'da €41/notte (2 persone)', "tutto l'anno", 'https://www.campercontact.com/it/italia/campania/pompei/92090/villa-julia-pompei-agricampeggio', null],
'cam-08': ['+39 371 1443189', 'https://www.laterrazzadihermes.com/', '€30–35 bassa stagione, €40–45 lug–ago (solo carico/scarico €5)', "tutto l'anno", 'https://www.laterrazzadihermes.com/prezzi', null],
'cam-09': ['+39 081 8781344', 'https://www.nubedargento.com/', null, 'aprile–ottobre (+Capodanno/Pasqua)', 'https://www.nubedargento.com/it/tariffe-e-prenotazioni', null],
'cam-10': ['+39 081 8073579', 'https://www.santafortunata.eu/', '~€50/giorno camper+2 adulti', 'aprile–ottobre', 'https://www.camperonline.it/sosta-camper/campeggi/italia/campania/santa-fortunata-campogaio/5693', null],
'cam-11': [null, null, null, null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/campania/parcheggio/24740', null],
'cam-12': ['+39 333 9231043', 'https://camperstopitaly.com/it', '€20–25/giorno (solo pernotto+corrente €12)', "tutto l'anno", 'https://camperstopitaly.com/listino-prezzi.php', null],
'cam-13': ['+39 0828 851042', 'https://www.villaggionettuno.com/', 'piazzola+1 persona €30–40 secondo stagione (extra €5–10)', 'aprile–agosto', 'https://www.villaggionettuno.com/prezzi-campeggio/', null],
'cam-14': ['+39 333 1896457', 'https://www.areacampercastellabate.com/', '€20–35/notte fino 4 persone (agosto su richiesta)', 'aprile–ottobre', 'https://www.areacampercastellabate.com/tariffe', null],
'cam-15': ['+39 329 5782296', 'https://www.campeggiomingardo.it/', 'piazzola €18–30 + persona €11–19/notte', '13 giugno–31 agosto', 'https://www.campeggiomingardo.it/', null],
'cam-16': [null, 'https://www.camperworld.it/', null, null, 'https://www.camperworld.it/', null],
'cam-17': ['+39 081 5316755', 'https://www.romanocaravans.com/', null, null, 'https://www.romanocaravans.com/contatti/', null],
'laz-01': ['+39 06 7886904', 'https://www.rexbus.it/area-sosta-camper-roma/', '€40/notte (festività €50; >8m €50/60€; docce €1)', 'annuale (8:00-22:00, H24)', 'https://www.rexbus.it/area-sosta-camper-roma/', null],
'laz-02': ['+39 327 7011468', null, null, 'annuale', 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/lazio/area-camper-saliola/9938', 'Presso carrozzeria, bus 118/218; solo contanti'],
'laz-03': ['+39 06 2427518', 'https://www.lgproma.com/home.html', '~€30/notte (5 notti €130; doccia €1,50)', "tutto l'anno H24", 'https://www.lgproma.com/tariffe.html', null],
'laz-04': ['+39 392 1645683', 'https://www.facebook.com/p/Area-sosta-camper-Roma-Nord-61568171024601/', '€30/24h', null, 'https://www.facebook.com/p/Area-sosta-camper-Roma-Nord-61568171024601/', 'Treno centro 15min; WhatsApp +39 3925199095'],
'laz-05': ['+39 333 6585694', 'https://www.miralagoromaest.com/', null, "tutto l'anno", 'https://www.miralagoromaest.com/', null],
'laz-06': ['+39 06 20190700', 'https://www.baiaholiday.com/roma-capitol/', 'da booking online (preventivo)', 'stagionale (fino al 09/11/2026)', 'https://www.baiaholiday.com/roma-capitol/', null],
'laz-07': ['+39 375 6351697', 'https://agricampeggiolabiososta.com/', null, null, 'https://agricampeggiolabiososta.com/', null],
'laz-08': ['+39 393 9996039', 'https://www.agricampeggiopaliano.com/', '€20/notte (2 persone)', null, 'https://www.agricampeggiopaliano.com/', null],
'laz-09': [null, null, null, null, null, 'Eventi/degustazioni; nessun contatto pubblicato online — verificare esistenza prima di partire'],
'laz-10': ['+39 0761 600972', null, null, null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/lazio/country-bar-pinseria-gentile/11934', null],
'laz-11': ['+39 351 7030453', 'https://www.sosta-camper-orte.it/', '€20 tutto l\u2019anno (+persona €4, luce €5)', 'annuale', 'https://www.sosta-camper-orte.it/prezzi/', null],
'laz-12': ['+39 328 3736209', null, null, null, 'https://www.openstreetmap.org (nodo Quirino Area Sosta Camper, Gaeta)', null],
'laz-13': [null, null, null, null, 'https://www.pitchup.com/campsites/italy/lazio/latina/sabaudia/agricampeggio_fratelli_mizzon/', 'Esistenza confermata su Pitchup; nessun telefono/prezzo pubblicato'],
'laz-14': ['+39 334 9365970', 'https://www.circemed.com/', '~€30/giorno', 'marzo–autunno (chiusa inverno)', 'https://www.circemed.com/area-sosta-camper-caravan/', null],
'laz-15': ['+39 389 5207422', null, null, null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/lazio/area-sota-camper-la-vignola-ex-l-ardino/28438', null],
'laz-16': [null, 'https://www.campertecnica.it/', null, null, 'https://www.campertecnica.it/', null],
'sar-01': ['+39 338 7319626', 'https://www.oasigallura.it/', null, '25 aprile – 20 ottobre', 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/oasi-gallura/2269', null],
'sar-02': ['+39 079 936033', 'https://www.paradisepark.it/', '€27–38/notte secondo mese (elettricità inclusa)', 'maggio – ottobre', 'https://www.paradisepark.it/', null],
'sar-03': [null, null, null, "tutto l'anno", 'https://park4night.com/en/place/86870', 'Ticket al bar/ristorante fronte porto; telefono solo in loco'],
'sar-04': [null, null, '€5 a servizio (carico/scarico)', null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/camper-service-palau/28516', null],
'sar-05': ['+39 335 5640546', null, '€15/notte + €12 elettricità', 'stagionale (chiusura ~fine settembre)', 'https://park4night.com/en/place/81808', null],
'sar-06': ['+39 328 5555848', 'https://www.campingtorredibarisardo.com/', 'preventivo via mail/WhatsApp', '1 gennaio – 31 dicembre', 'https://www.norcamp.de/it/italia/sosta-camping-torre-di-bari-sardo.17721.1.html', null],
'sar-07': ['+39 0789 704019', 'https://www.isoladeigabbiani.it/', '€20–58/notte secondo stagione', '1 aprile – 25 ottobre', 'https://www.norcamp.de/it/italia/camping-isola-dei-gabbiani.17501.1.html', null],
'sar-08': ['+39 0789 40166', 'https://www.camping-tavolara.it', 'piazzola €9–20 + adulto €10–14/notte', '22 aprile – 14 ottobre', 'https://www.camping-tavolara.it/it/listino.php', null],
'sar-09': ['+39 0781 809058', 'https://www.camping-tonnara.it', null, null, 'https://www.sardegnaturismo.it/it/organizza/dormire/tonnara', 'WhatsApp +39 348 1748503 per disponibilità'],
'sar-10': ['+39 0783 22074', 'https://www.spinnakervacanze.com/', 'preventivo online', 'primavera–autunno', 'https://www.spinnakervacanze.com/en/opening-hours/', null],
'sar-11': ['+39 340 7788952', null, 'da €19/notte', 'fino al 1 novembre', 'https://www.campercontact.com/it/italia/sardegna/santanna-arresi/21115/agricamping-il-ruscello', null],
'sar-12': ['+39 349 0733872', 'https://www.agricampeggiogliulivi.it/', null, 'maggio – settembre', 'https://www.camperonline.it/sosta-camper/campeggi/italia/sardegna/agricampeggio-gli-ulivi/23532', null],
'sar-13': ['+39 333 8592973', 'https://www.paulesa.com', null, "tutto l'anno", 'https://www.paulesa.com/contatti', null],
'sar-14': ['+39 328 9366505', null, null, 'giugno – settembre', 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/agricampeggio-muras-da-giuliano/23334', null],
'sar-15': [null, 'https://www.gambinocamper.it', null, 'lun–ven 8:30–13/16–19, sab 9–12:30', 'https://www.gambinocamper.it/mezzo-nuovo/', null],
'sar-16': [null, null, null, null, 'https://www.scovaziende.com/noleggio-camper/35-autocaravan-rent-srl.html', null],
'sic-01': ['+39 091 6515010', 'https://www.greencarpalermo.it', null, null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sicilia/parking-green-car/2465', null],
'sic-02': [null, 'https://ideavacanzepa.it/', '€20/notte (oltre 8,5m €30; elettricità extra)', 'annuale H24', 'https://ideavacanzepa.it/', null],
'sic-03': ['+39 0921 420184', 'https://www.campingsanfilippo.com/camping', null, '1 aprile – 31 ottobre', 'https://www.campingsanfilippo.com/camping', null],
'sic-04': [null, 'https://www.sicilypark.it/area-sosta-camper-catania/', '€10/giorno', 'annuale H24', 'https://www.sicilypark.it/', null],
'sic-05': ['+39 389 8850103', 'https://monsgibelcampingpark.it/', 'camper €10–12 + persona / Camper Stop €15–20', 'annuale', 'https://monsgibelcampingpark.it/listino-prezzi/', null],
'sic-06': ['+39 328 8762525', 'https://areasostaspuligni.com', '€20/notte tutto compreso', '7 gennaio – 20 dicembre', 'https://areasostaspuligni.com', null],
'sic-07': ['+39 095 931548', 'https://www.etnawineagriturismo.it/en/agricamper.html', 'da €20/notte', null, 'https://www.campercontact.com/it/italia/sicilia/castiglione-di-sicilia/9498/area-etna-wine-agriturismo', null],
'sic-08': ['+39 339 8780412', 'https://agricampeggioalessandra.com', null, '365 giorni', 'https://agricampeggioalessandra.com/piazzole-camper-agricampeggio-alessandra-messina/', null],
'sic-09': ['+39 0942 54120', 'http://www.parkinglagani.it', '€17–18,50/notte + €0,50/kWh', 'annuale', 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sicilia/parking-lagani/2417', null],
'sic-10': ['+39 340 5356119', 'https://www.sostacamperclaudcar.com', '€26–35/notte (7 notti €140 bassa stagione)', 'annuale', 'https://www.sostacamperclaudcar.com/prezzi', null],
'sic-11': [null, null, '€15–16/notte (+luce €3)', '1 giugno – 30 settembre', 'https://camperstop.com/it/csa/italia/sicilia/noto/parcheggio-calamosche/13330', null],
'sic-12': ['+39 347 5338111', 'https://www.agrimaccari.it/it', null, null, 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sicilia/agrimaccari/13561', null],
'sic-13': ['+39 0932 918401', 'https://www.campingluminoso.com', '€15–50/notte (offerte inverno)', 'annuale', 'https://www.campingluminoso.com', null],
'sic-14': [null, 'https://www.elbahira.it', null, 'annuale (servizi ridotti nov–mar)', 'https://www.elbahira.it', null],
'sic-15': [null, 'http://www.lisoladelsale.it/it/area-attrezzata', '€10–20/equipaggio secondo stagione', 'annuale H24', 'http://www.lisoladelsale.it/it/area-attrezzata', null],
'sic-16': ['+39 333 6635936', null, '€25/notte tutto compreso', null, 'https://www.campercontact.com/it/italia/sicilia/realmonte/50811/area-attrezzata-parking-scala-dei-turchi-lmichelangelo', 'Solo pagina Facebook Parkingland, nessun sito ufficiale'],
'sic-17': ['+39 0922 411115', 'https://campingvalledeitempli.com', 'camper €11–12 + persona €6–10/notte + luce', 'annuale', 'https://campingvalledeitempli.com/prezzi/', null],
'sic-18': [null, 'https://doctorcamper.it', null, 'lun–ven, sab su appuntamento', 'https://doctorcamper.it', null],
};

let nTel = 0, nSito = 0, nPrezzo = 0, nStag = 0, nNd = 0;
for (const f of ['campania', 'lazio', 'sardegna', 'sicilia']) {
  const p = `frontend/data/${f}.json`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  for (const it of arr) {
    const r = R[it.id];
    if (r) {
      const [tel, sito, prezzo, stagione, fonte, note] = r;
      if (tel) it.tel = tel;
      if (sito) it.sito = sito;
      if (prezzo) it.prezzo = prezzo;
      else if (/n\.d\./i.test(it.prezzo || '')) it.prezzo = 'contattare la struttura';
      if (stagione) it.stagione = stagione;
      if (fonte) it.fonte = fonte;
      if (note) it.note = note;
      it.verificato = '2026-10-22';
    } else if (/n\.d\./i.test(it.prezzo || '')) {
      it.prezzo = 'contattare la struttura';
    }
    if (it.tel) nTel++;
    if (it.sito) nSito++;
    if (!/n\.d\./i.test(it.prezzo || '') && !/contattare/i.test(it.prezzo || '')) nPrezzo++;
    if (it.stagione) nStag++;
    if (/n\.d\./i.test(it.prezzo || '')) nNd++;
  }
  writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
  console.log(f + ' aggiornato');
}
console.log(`tel:${nTel}/67 sito:${nSito}/67 prezzo reale:${nPrezzo}/67 stagione:${nStag}/67 n.d.rimasti:${nNd}`);
