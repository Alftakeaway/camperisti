import { readFileSync, writeFileSync } from 'fs';
const P = {
'cam-11': { tel: '+39 089 2769111', sito: 'https://www.salernomobilita.it/index.php/servizi/aree-camper/', prezzo: '€10 sosta; €15 con acqua; €20 con acqua+luce (H24)', stagione: 'annuale H24', fonte: 'https://www.salernomobilita.it/index.php/servizi/aree-camper/', note: 'Gestita da Salerno Mobilità; asfalto pianeggiante, non ombreggiato; pagamento al box; no prenotazione.' },
'laz-05': { prezzo: '€25–30/equipaggio (da recensioni e Campercontact 2026)', fonte: 'https://www.campercontact.com/it/italia/lazio/roma/6790/area-camper-club-mira-lago-roma', note: 'Camper Club Mira Lago, Via di Lunghezzina 75; navetta stazione; docce a gettoni.' },
'laz-09': { tel: '+39 328 2790397', sito: 'http://www.areacamperilguadetto.it', prezzo: '€17/24h tutto compreso', stagione: null, fonte: 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/lazio/area-guadetto/990', note: 'ATTENZIONE: segnalata CHIUSA fino a nuova comunicazione (camperonline) — chiamare prima. 50 piazzole fronte lago.' },
'laz-13': { tel: '+39 0773 593045 / +39 349 2975852', sito: 'http://www.agriturismomizzon.com', prezzo: null, stagione: null, fonte: 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/lazio/agriturismo-campeggio-flli-mizzon/13508', note: 'Esistenza confermata su Pitchup; camperonline la segnala CHIUSA — verificare prima di partire.' },
'sar-01': { prezzo: '€27–38/giorno 2 persone (listino ufficiale 2026)', stagione: '24 aprile – 20 ottobre', fonte: 'https://www.oasigallura.it/public/Listini%202026/AREA_CAMPER_Listino_Prezzi_2026_italiano.pdf', note: '95 piazzole; sconto 10% tessera COL.' },
'sar-03': { tel: '+39 349 647 3099', prezzo: null, stagione: "tutto l'anno", fonte: 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/la-marina/23590', note: 'Ticket al bar/ristorante fronte porto turistico; NO scarico; 10 stalli.' },
'sar-04': { prezzo: '€5 a singolo servizio (acqua/scarichi)', stagione: 'annuale H24', fonte: 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/camper-service-palau/28516', note: 'Stazione automatica a pagamento in zona industriale; unica in zona.' },
'sar-09': { prezzo: 'da €29/notte (fino a ~€50 in alta)', stagione: '18 aprile – 4 ottobre', fonte: 'https://www.campercontact.com/en/italy/sardinia/santu-antiogusantantioco/41912/camping-tonnara', note: 'Sito ufficiale non raggiungibile al controllo; 120 piazzole fronte baia.' },
'sar-12': { prezzo: '€40–57/notte 2 persone secondo mese (listino Campercontact 2026)', stagione: 'maggio – settembre', fonte: 'https://www.campercontact.com/en/italy/sardinia/castiadas/79918/agricampeggio-gli-ulivi', note: '6 piazzole con bagno privato; ristorante su prenotazione.' },
'sar-13': { prezzo: '€25/notte tutto incluso (da recensioni 2024)', stagione: "tutto l'anno", fonte: 'https://www.camperonline.it/sosta-camper/aree-di-sosta/italia/sardegna/agriturismo-paulesa/10621', note: 'Sosta gratis per chi cena in struttura (convenzione).' },
'sic-12': { tel: '+39 347 5338111', sito: 'https://www.agrimaccari.com/it', prezzo: 'piazzola €12/mezzo + adulto €12–22 secondo stagione', stagione: null, fonte: 'https://www.agrimaccari.com/it/soggiorni/piazzole/', note: 'Listino completo solo sul booking engine del sito ufficiale.' },
'sic-14': { prezzo: 'da €23/notte bassa stagione (ACSI)', stagione: null, fonte: 'https://www.campingcard.co.uk/italy/sicily/trapani/san-vito-lo-capo/camping-el-bahira-111453', note: 'Listino piazzole completo solo in sede; tassa soggiorno e docce calde extra.' },
};
for (const f of ['campania', 'lazio', 'sardegna', 'sicilia']) {
  const p = `frontend/data/${f}.json`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  for (const it of arr) {
    const r = P[it.id];
    if (!r) continue;
    for (const k of ['tel', 'sito', 'prezzo', 'stagione', 'fonte', 'note']) if (r[k]) it[k] = r[k];
    it.verificato = '2026-10-22';
  }
  writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
}
let t = 0, s = 0, pr = 0;
for (const f of ['campania', 'lazio', 'sardegna', 'sicilia'])
  for (const x of JSON.parse(readFileSync(`frontend/data/${f}.json`, 'utf8'))) {
    if (x.tel) t++;
    if (x.sito) s++;
    if (x.prezzo && !/contattare|preventivo|n\.d\./i.test(x.prezzo)) pr++;
  }
console.log(`tel:${t}/67 sito:${s}/67 prezzo-pubblicato:${pr}/67`);
