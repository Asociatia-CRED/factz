# factz.ro – ghid de publicare pe Azure

Acest folder conține tot site-ul, gata de pus pe GitHub și publicat pe Azure, pe domeniul **factz.ro**.

| Fișier / folder | Ce face |
|---|---|
| `index.html` | Site-ul complet: partea pentru cititori și studioul redacției |
| `api/` | Funcțiile de server: articole, comentarii, reacții, sondaje, încărcare de poze (date în Azure Table Storage) |
| `api/src/seed.json` | Conținutul demo, importat opțional la prima configurare |
| `staticwebapp.config.json` | Setările Azure Static Web Apps |

Durează în total cam o oră, din care o bună parte e așteptare.

---

## Pasul 1. Pune fișierele pe GitHub

1. Intră pe [github.com](https://github.com) cu contul organizației Asociatia-CRED.
2. Sus-dreapta, apasă **+** și apoi **New repository**.
3. La *Repository name* scrie `factz` (organizația Asociatia-CRED). Depozitul actual e public. Apasă **Create repository**.
4. Pe pagina care apare, apasă linkul **uploading an existing file**.
5. Dezarhivează arhiva primită și trage **conținutul** folderului (nu folderul însuși) în fereastra GitHub: `index.html`, `staticwebapp.config.json`, `README.md` și folderul `api`.
6. Jos, apasă **Commit changes**.

> Verifică: în depozit trebuie să vezi direct `index.html` și folderul `api`, nu un alt folder care le conține.

## Pasul 2. Activează grantul Azure pentru ONG

1. Intră pe [nonprofit.microsoft.com](https://nonprofit.microsoft.com) cu contul asociației și finalizează verificarea organizației, dacă nu ai făcut-o deja.
2. În *Nonprofit Hub*, la oferte, activează **Azure grant** (2.000 USD credite pe an).
3. Ți se cere un card pentru verificare. Nu plătești nimic cât timp rămâi în limita grantului. Tot ce e descris aici consumă foarte puțin din el.

## Pasul 3. Creează grupul de resurse

În [portal.azure.com](https://portal.azure.com):

1. Caută **Resource groups**, apoi **Create**.
2. Nume: `factz`. Regiune: **Austria East**. Apoi **Review + create** și **Create**.

Toate resursele de mai jos le pui în acest grup.

## Pasul 4. Spațiul pentru date, poze și video (Storage account)

Un singur Storage account ține tot: articolele și restul datelor (în **Table Storage**) și pozele și clipurile (în **Blob Storage**).

1. Caută **Storage accounts**, apoi **Create**.
2. Completează:
   - *Resource group:* `factz`
   - *Storage account name:* de exemplu `factzmedia` (doar litere mici și cifre, unic)
   - *Region:* **Austria East** (sau altă regiune din UE)
   - *Primary service:* **Azure Blob Storage or Azure Data Lake Storage Gen 2**
   - *Performance:* Standard
   - *Redundancy:* **Locally-redundant storage (LRS)**
3. În tabul **Advanced**:
   - bifează **Allow enabling anonymous access on individual containers** (ca pozele din articole să fie vizibile pentru cititori);
   - lasă **nebifat** *Enable hierarchical namespace*.
4. **Review and create**, apoi **Create**.
5. Deschide resursa, apoi **Security + networking > Access keys** și copiază **Connection string** de la key1.

Nu trebuie să creezi tabele sau foldere. Site-ul le creează singur la prima pornire.

## Pasul 5. Site-ul (Static Web App)

1. Caută **Static Web Apps**, apoi **Create**.
2. Completează:
   - *Resource group:* `factz`
   - *Name:* `factz`
   - *Plan type:* **Free**
   - *Source:* **GitHub**. Autentifică-te și alege depozitul `factz` (organizația Asociatia-CRED), ramura `main`.
   - *Build Presets:* **Custom**
   - *App location:* `/`
   - *Api location:* `api`
   - *Output location:* lasă gol
3. **Review + create**, apoi **Create**.

Azure adaugă singur un fișier de publicare în GitHub și construiește site-ul. Poți urmări progresul în GitHub, la tabul **Actions**. Durează 2–4 minute.

## Pasul 6. Leagă spațiul de stocare de site

1. În Static Web App, mergi la **Settings > Environment variables**.
2. Adaugă o singură setare:

| Name | Value |
|---|---|
| `STORAGE_CONNECTION_STRING` | textul copiat la pasul 4 |

3. Apasă **Apply**.

## Pasul 7. Configurează studioul (fă-o imediat)

> **Important:** primul cont care intră în studio devine administrator. Fă acest pas imediat după publicare.

1. În Static Web App, la **Overview**, deschide adresa de tip `https://ceva.azurestaticapps.net`.
2. Adaugă la final `/#/cn-studio` și apasă Enter.
3. Apasă **Intră cu Microsoft** (sau GitHub) și autentifică-te.
4. Scrie-ți numele. Bifează **Încarcă și conținutul demo** dacă vrei să vezi site-ul plin, apoi apasă **Creează contul de administrator**.

> **Dacă după autentificare apare „Nu ai acces încă”** (Azure îți arată uneori adresa mascată, de forma „aso*****”): pe pagina respectivă apare un **cod de acces**. Copiază-l, apoi în Azure, la Static Web App > Settings > Environment variables, adaugă setarea `ADMIN_USER_IDS` cu acest cod și reîncarcă pagina. Contul tău de administrator se leagă permanent de acel cod.

## Pasul 8. Adaugă redacția

În studio, la **Utilizatori > Adaugă utilizator**, completează pentru fiecare membru adresa exactă a contului Microsoft cu care va intra, sau numele de utilizator GitHub. Dacă persoana vede „Nu ai acces încă”, pagina îi afișează un **cod de acces**: pune codul în locul adresei. După prima intrare reușită, contul rămâne legat de persoană. Alege rolul:

- **Jurnalist:** scrie articole și le trimite spre revizuire.
- **Editor:** aprobă, publică, moderează comentarii, gestionează dosare și sondaje.
- **Administrator:** tot ce face editorul, plus utilizatori și setări.

Persoana intră apoi la `factz.ro/#/cn-studio` cu acel cont. Adresa studioului se poate schimba din **Setări**. Pe site nu există niciun link vizibil spre studio. Se mai poate intra apăsând de 5 ori pe „©” din subsol.

## Pasul 9. Leagă domeniul factz.ro

În Static Web App, mergi la **Settings > Custom domains > Add**.

### Varianta recomandată: DNS în Azure

1. În portal, caută **DNS zones**, apoi **Create**. Resource group `factz`, nume `factz.ro`.
2. Deschide zona creată și notează cele 4 adrese de la **Name servers** (de forma `ns1-xx.azure-dns.com`).
3. În contul **Hostico**, la domeniul `factz.ro`, înlocuiește nameserverele cu cele 4 de la Azure.
4. În Static Web App, la **Custom domains > Add > Custom domain on Azure DNS**, alege `factz.ro`. Azure creează singur înregistrările și certificatul SSL.
5. Repetă pentru `www.factz.ro`.

### Varianta simplă: DNS rămâne la Hostico

1. **www.factz.ro:** în Azure alege *Custom domain on other DNS*, scrie `www.factz.ro`. La Hostico, în zona DNS, adaugă un **CNAME** cu numele `www` și valoarea adresei `ceva.azurestaticapps.net`.
2. **factz.ro:** în Azure scrie `factz.ro`, alege validare **TXT** și copiază codul. La Hostico adaugă un **TXT** cu gazda `@` și codul ca valoare. După validare, adaugă o înregistrare **A** cu gazda `@` spre adresa IP afișată de Azure.

Schimbările de domeniu pot dura până la 72 de ore. Certificatul SSL (https) e creat automat și gratuit.

## Asistentul AI de redacție

Asistentul citește o dată pe oră (8–23) sursele RSS alese în **Studio > Asistent AI**, alege subiectele importante, scrie ciorne cu cuvinte proprii cu modelul `factz-writer` din Azure și le trimite în studio ca **„În revizuire”**. **Nu publică nimic singur.** Fiecare ciornă are o listă de lucruri de verificat și linkuri spre surse, iar după publicare Fișa de încredere menționează transparent că prima variantă a fost pregătită cu AI.

### Configurare (o singură dată)

1. **Urcă fișierele noi pe GitHub** (conținutul arhivei, ca de obicei). Arhiva conține folderele `automation` și `github-workflow`.
2. **Activează programarea orară.** Pe GitHub, în depozit: **Add file > Create new file**. La nume scrie exact `.github/workflows/asistent.yml` (cu punct la început și cu slash-uri). Deschide pe calculator fișierul `github-workflow/asistent.yml` din arhivă, copiază tot conținutul, lipește-l pe GitHub și apasă **Commit changes**.
3. **Generează cheia asistentului.** În **Studio > Asistent AI**, la „Cheia asistentului”, apasă **Generează**, apoi **Copiază**.
4. **Pune cheia în Azure.** Static Web App > Settings > Environment variables > Add: `AGENT_TOKEN` = cheia copiată. Apply.
5. **Pune setările în GitHub.** În depozit: **Settings > Secrets and variables > Actions**.
   - Tabul **Secrets** > **New repository secret**:
     - `AGENT_TOKEN` = aceeași cheie de la pasul 3
     - `AI_KEY` = cheia modelului din Foundry (ai.azure.com > Models > `factz-writer` > Details > Key)
   - Tabul **Variables** > **New repository variable**:
     - `SITE_URL` = adresa site-ului, de exemplu `https://proud-water-01a47bd0f.6.azurestaticapps.net` (sau `https://factz.ro` după legarea domeniului)
     - `AI_ENDPOINT` = `https://asociatiacred-1798-resource.services.ai.azure.com/openai/v1`
     - `AI_DEPLOYMENT` = `factz-writer`
6. **Prima rulare, manual.** GitHub > tabul **Actions** > **Asistent factz** > **Run workflow**. După 1–2 minute, vezi rezultatul în **Studio > Asistent AI > Ultimele rulări**, iar ciornele în lista „Ciorne care așteaptă verificarea”.

### Bine de știut
- **Costuri:** aproximativ 5–7 cenți pe ciornă (4 etape: alegere, analiza surselor, scriere, verificare). Limita zilnică se setează din studio (implicit 10 pe zi, 2 pe rulare).
- **Tipuri de ciorne:** „știre” (cel puțin 2 publicații și 2 surse originale), „declarație” (totul vine dintr-o singură sursă; text scurt, clar atribuit) și „rezumat de investigație” (material exclusiv al unei publicații; trimite cititorul la sursă). Problemele găsite (contradicții între surse, informații neconfirmate) apar cu roșu în editor, la „De rezolvat înainte de publicare”.
- **Sursele care nu merg** apar cu roșu în „Ultimele rulări”. Corectează adresa sau scoate sursa din listă.
- **Oprire temporară:** debifează „Asistent pornit” în studio.
- **GitHub oprește programările** în depozitele publice fără activitate timp de 60 de zile. Dacă se întâmplă, le reactivezi din tabul Actions.
- **Cheia AI și AGENT_TOKEN sunt secrete.** Nu le pune niciodată în fișiere, doar în Secrets și Environment variables.

## Cum faci actualizări

Orice fișier schimbat în GitHub se publică automat în 2–4 minute. Când primești o versiune nouă a site-ului, în depozit deschide `index.html`, apoi meniul cu trei puncte, **Delete file**, apoi încarcă noul fișier cu **Add file > Upload files**.

## Probleme frecvente

| Problema | Soluția |
|---|---|
| Site-ul se încarcă, dar e gol și nu poți configura studioul | Lipsește setarea `STORAGE_CONNECTION_STRING` de la pasul 6, sau a fost copiată greșit. |
| La încărcarea unei poze apare o eroare | Verifică bifa de acces anonim de la pasul 4 (Storage account > Settings > Configuration). |
| „Nu ai acces încă” după autentificare | Folosește codul de acces afișat pe pagină: în Studio > Utilizatori în locul adresei, sau, pentru administrator, în setarea `ADMIN_USER_IDS` din Azure. |
| Site-ul nu se actualizează după o modificare în GitHub | Verifică tabul **Actions**. Dacă un pas e roșu, deschide-l și trimite mesajul de eroare. |

## Bine de știut

- **Costuri:** planul Free al Static Web Apps e gratuit, iar Storage account costă câțiva cenți pe lună la volumul unui site de știri la început. Totul intră lejer în grantul Azure.
- **Date personale:** e-mailurile abonaților și ale redacției nu sunt trimise niciodată către vizitatori. Comentariile apar public doar după aprobare.
- **Ce mai poate urma:** trimiterea efectivă a newsletterului, notificări push, aplicație instalabilă și adrese de pagină compatibile cu Google (`factz.ro/articol/...`).

---

## Newsletterul de dimineață (din versiunea 5)

Newsletterul pleacă în fiecare zi la 7:00 (ora României), cu știrile publicate în ultimele 24 de ore, doar către abonații care și-au confirmat adresa. Dacă nu s-a publicat nimic, nu se trimite. E-mailurile pleacă prin **Azure Communication Services (Email)**.

Setări în Azure (Static Web App > Environment variables):
- `ACS_CONNECTION_STRING`: conexiunea resursei Communication Services (Settings > Keys > Connection string);
- `NEWSLETTER_FROM` (opțional): expeditorul, implicit `DoNotReply@factz.ro`.

În GitHub, fișierul `.github/workflows/newsletter.yml` (copia e în `github-workflow/newsletter.yml`) pornește trimiterea. Folosește aceleași setări ca asistentul (`SITE_URL`, `AGENT_TOKEN`). Se poate porni și manual din Actions > Newsletter factz > Run workflow.

Din studio, la **Abonați**: previzualizare, e-mail de test, oprire/pornire și starea ultimei trimiteri. Dezabonarea șterge adresa definitiv; abonările neconfirmate se șterg după 30 de zile.

## Fotografii propuse de asistent

Asistentul caută fotografii cu licență liberă (CC0, domeniu public, CC BY, CC BY-SA) pe Wikimedia Commons și Openverse și propune una doar dacă arată sigur subiectul. Creditul (autor, sursă, licență) apare sub fotografie, cu link spre sursă, și în Fișa de încredere. Fotografiile din articolele-sursă nu se folosesc niciodată. Se oprește din Studio > Asistent AI.

## Adrese de pagină (din versiunea 8)

Paginile au adrese reale, bune pentru Google: `factz.ro/articol/...`, `factz.ro/categorie/...`. Linkurile vechi de forma `factz.ro/#/articol/...` duc automat la adresa nouă. Studioul e la `factz.ro/cn-studio` (sau adresa aleasă în Setări). Harta site-ului pentru Google e la `factz.ro/api/sitemap` și e indicată în `robots.txt`; se poate trimite și din Google Search Console.

## Carusel Instagram

În editorul fiecărui articol salvat, butonul **Carusel Instagram** generează imagini 1080×1350 (copertă, ideile „Pe scurt”, surse) și textul postării. Imaginile se creează în browser, fără cost.

## Aplicație pe telefon

Cititorii pot adăuga factz.ro pe ecranul telefonului (Safari: Partajează > Adaugă pe ecranul principal; Chrome: Instalează aplicația). Iconițele sunt `icon-*.png` și `apple-touch-icon.png`, descrise în `manifest.webmanifest`.
