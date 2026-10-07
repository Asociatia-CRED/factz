# factz.ro – ghid de publicare pe Azure

Acest folder conține tot site-ul, gata de pus pe GitHub și publicat pe Azure, pe domeniul **factz.ro**.

| Fișier / folder | Ce face |
|---|---|
| `index.html` | Site-ul complet: partea pentru cititori și studioul redacției |
| `api/` | Funcțiile de server: articole, comentarii, reacții, sondaje, încărcare de poze |
| `api/src/seed.json` | Conținutul demo, importat opțional la prima configurare |
| `staticwebapp.config.json` | Setările Azure Static Web Apps |

Durează în total cam o oră, din care o bună parte e așteptare.

---

## Pasul 1. Pune fișierele pe GitHub

1. Fă-ți cont gratuit pe [github.com](https://github.com) (sau intră în contul tău).
2. Sus-dreapta, apasă **+** și apoi **New repository**.
3. La *Repository name* scrie `spill-the-facts`. Poți alege **Private**. Apasă **Create repository**.
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
2. Nume: `spillthefacts`. Regiune: **West Europe**. Apoi **Review + create** și **Create**.

Toate resursele de mai jos le pui în acest grup.

## Pasul 4. Baza de date (Cosmos DB)

1. Caută **Azure Cosmos DB**, apoi **Create** și alege **Azure Cosmos DB for NoSQL**.
2. Completează:
   - *Resource group:* `spillthefacts`
   - *Account name:* de exemplu `spillthefacts-db` (trebuie să fie unic)
   - *Location:* **West Europe**
   - *Capacity mode:* **Provisioned throughput**
   - *Apply Free Tier Discount:* **Apply** (gratuit până la 1000 RU/s și 25 GB, mult peste ce îți trebuie la început)
3. **Review + create**, apoi **Create**. Durează câteva minute.
4. Deschide resursa, apoi **Settings > Keys** și copiază **PRIMARY CONNECTION STRING**. Îl folosești la pasul 7.

Nu trebuie să creezi baza de date sau tabelele. Site-ul le creează singur la prima pornire.

## Pasul 5. Spațiul pentru poze și video (Storage account)

1. Caută **Storage accounts**, apoi **Create**.
2. Completează:
   - *Resource group:* `spillthefacts`
   - *Storage account name:* de exemplu `spillthefactsmedia` (doar litere mici și cifre, unic)
   - *Region:* **West Europe**
   - *Performance:* Standard. *Redundancy:* LRS
3. În tabul **Advanced**, bifează **Allow enabling anonymous access on individual containers**. E necesar ca pozele din articole să fie vizibile pentru cititori.
4. **Review + create**, apoi **Create**.
5. Deschide resursa, apoi **Security + networking > Access keys** și copiază **Connection string** de la key1.

## Pasul 6. Site-ul (Static Web App)

1. Caută **Static Web Apps**, apoi **Create**.
2. Completează:
   - *Resource group:* `spillthefacts`
   - *Name:* `spillthefacts`
   - *Plan type:* **Free**
   - *Source:* **GitHub**. Autentifică-te și alege depozitul `spill-the-facts`, ramura `main`.
   - *Build Presets:* **Custom**
   - *App location:* `/`
   - *Api location:* `api`
   - *Output location:* lasă gol
3. **Review + create**, apoi **Create**.

Azure adaugă singur un fișier de publicare în GitHub și construiește site-ul. Poți urmări progresul în GitHub, la tabul **Actions**. Durează 2–4 minute.

## Pasul 7. Leagă baza de date și spațiul pentru poze

1. În Static Web App, mergi la **Settings > Environment variables**.
2. Adaugă două setări:

| Name | Value |
|---|---|
| `COSMOS_CONNECTION_STRING` | textul copiat la pasul 4 |
| `STORAGE_CONNECTION_STRING` | textul copiat la pasul 5 |

3. Apasă **Apply**.

## Pasul 8. Configurează studioul (fă-o imediat)

> **Important:** primul cont care intră în studio devine administrator. Fă acest pas imediat după publicare.

1. În Static Web App, la **Overview**, deschide adresa de tip `https://ceva.azurestaticapps.net`.
2. Adaugă la final `/#/cn-studio` și apasă Enter.
3. Apasă **Intră cu Microsoft** (sau GitHub) și autentifică-te.
4. Scrie-ți numele. Bifează **Încarcă și conținutul demo** dacă vrei să vezi site-ul plin, apoi apasă **Creează contul de administrator**.

## Pasul 9. Adaugă redacția

În studio, la **Utilizatori > Adaugă utilizator**, completează pentru fiecare membru adresa exactă a contului Microsoft cu care va intra, sau numele de utilizator GitHub. Alege rolul:

- **Jurnalist:** scrie articole și le trimite spre revizuire.
- **Editor:** aprobă, publică, moderează comentarii, gestionează dosare și sondaje.
- **Administrator:** tot ce face editorul, plus utilizatori și setări.

Persoana intră apoi la `factz.ro/#/cn-studio` cu acel cont. Adresa studioului se poate schimba din **Setări**. Pe site nu există niciun link vizibil spre studio. Se mai poate intra apăsând de 5 ori pe „©” din subsol.

## Pasul 10. Leagă domeniul factz.ro

În Static Web App, mergi la **Settings > Custom domains > Add**.

### Varianta recomandată: DNS în Azure

1. În portal, caută **DNS zones**, apoi **Create**. Resource group `spillthefacts`, nume `factz.ro`.
2. Deschide zona creată și notează cele 4 adrese de la **Name servers** (de forma `ns1-xx.azure-dns.com`).
3. În contul **Hostico**, la domeniul `factz.ro`, înlocuiește nameserverele cu cele 4 de la Azure.
4. În Static Web App, la **Custom domains > Add > Custom domain on Azure DNS**, alege `factz.ro`. Azure creează singur înregistrările și certificatul SSL.
5. Repetă pentru `www.factz.ro`.

### Varianta simplă: DNS rămâne la Hostico

1. **www.factz.ro:** în Azure alege *Custom domain on other DNS*, scrie `www.factz.ro`. La Hostico, în zona DNS, adaugă un **CNAME** cu numele `www` și valoarea adresei `ceva.azurestaticapps.net`.
2. **factz.ro:** în Azure scrie `factz.ro`, alege validare **TXT** și copiază codul. La Hostico adaugă un **TXT** cu gazda `@` și codul ca valoare. După validare, adaugă o înregistrare **A** cu gazda `@` spre adresa IP afișată de Azure.

Schimbările de domeniu pot dura până la 72 de ore. Certificatul SSL (https) e creat automat și gratuit.

## Cum faci actualizări

Orice fișier schimbat în GitHub se publică automat în 2–4 minute. Când primești o versiune nouă a site-ului, în depozit deschide `index.html`, apoi meniul cu trei puncte, **Delete file**, apoi încarcă noul fișier cu **Add file > Upload files**.

## Probleme frecvente

| Problema | Soluția |
|---|---|
| Site-ul se încarcă, dar e gol și nu poți configura studioul | Lipsesc setările de la pasul 7, sau au fost copiate greșit. |
| La încărcarea unei poze apare o eroare | Verifică bifa de acces anonim de la pasul 5 (Storage account > Settings > Configuration). |
| „Nu ai acces încă” după autentificare | Adresa contului nu e adăugată exact la fel în Studio > Utilizatori. |
| Site-ul nu se actualizează după o modificare în GitHub | Verifică tabul **Actions**. Dacă un pas e roșu, deschide-l și trimite mesajul de eroare. |

## Bine de știut

- **Costuri:** planul Free al Static Web Apps și nivelul gratuit Cosmos DB acoperă un site de știri la început. Spațiul pentru poze costă câțiva cenți pe lună. Toate intră în grantul Azure.
- **Date personale:** e-mailurile abonaților și ale redacției nu sunt trimise niciodată către vizitatori. Comentariile apar public doar după aprobare.
- **Ce mai poate urma:** trimiterea efectivă a newsletterului, notificări push, aplicație instalabilă și adrese de pagină compatibile cu Google (`factz.ro/articol/...`).
