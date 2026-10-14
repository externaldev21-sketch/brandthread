/**
 * Compact city gazetteer for the seller Live map (routes/seller-live-map.ts).
 *
 * GENERATED FILE, do not edit by hand. Source: GeoNames "cities with a
 * population > 1000" (https://www.geonames.org/, licensed CC BY 4.0, credit
 * "GeoNames"), read through the npm package all-the-cities@3.1.0 (MIT code
 * wrapping that same GeoNames dump). A throwaway script outside the repo kept
 * populated places (feature code PPL*) with population >= 10,000 in the US
 * and >= 50,000 elsewhere, dropped duplicate (name, admin1, country) rows by
 * keeping the most populous, rounded lat/lng to 2 decimals (about 1 km, city
 * level by design), and sorted by country then population (descending).
 *
 * CITIES format: "#CC" starts a country block (ISO 3166-1 alpha-2); each
 * following line is "name<TAB>admin1 code<TAB>lat<TAB>lng". For the US the
 * admin1 code is the two-letter state code.
 *
 * US_STATE_CENTROIDS / COUNTRY_CENTROIDS are population-weighted centres of
 * every GeoNames 1000+ place in that state/country (so the fallback dot sits
 * where people live, not in an empty geometric centre). Format "code<TAB>lat<TAB>lng".
 */
export const CITIES = `#AE
Dubai	03	25.08	55.31
Sharjah	06	25.34	55.41
Abu Dhabi	01	24.45	54.4
Ajman City	02	25.4	55.48
Ras Al Khaimah City	05	25.79	55.94
Musaffah	01	24.36	54.48
Al Fujairah City	04	25.12	56.34
Khalifah A City	01	24.43	54.61
Reef Al Fujairah City	04	25.14	56.25
Bani Yas City	01	24.31	54.63
Zayed City	01	23.65	53.71
Umm Al Quwain City	07	25.56	55.56
Al Shamkhah City	01	24.39	54.71
Al Ain City	01	24.19	55.76
#AF
Kabul	13	34.53	69.17
Kandahār	23	31.61	65.71
Mazār-e Sharīf	30	36.71	67.11
Herāt	11	34.35	62.2
Jalālābād	18	34.43	70.45
Kunduz	24	36.73	68.86
Ghazni	08	33.55	68.42
Balkh	30	36.76	66.9
Baghlān	03	36.13	68.71
Gardez	36	33.6	69.23
Khōst	37	33.34	69.92
Maymana	07	35.92	64.78
Khanabad	24	36.68	69.12
Bāzār-e Yakāwlang	05	34.74	66.97
Bāzārak	42	35.31	69.52
Khulm	30	36.7	67.7
Taloqan	26	36.74	69.53
Bāmyān	05	34.82	67.83
Pul-e Khumrī	03	35.94	68.72
Shibirghān	31	36.67	65.75
Charikar	40	35.01	69.17
Sar-e Pul	33	36.22	65.93
#AL
Tirana	50	41.33	19.82
Durrës	42	41.32	19.45
Elbasan	43	41.11	20.08
Vlorë	51	40.47	19.48
Shkodër	49	42.07	19.51
Pogradec	46	40.9	20.65
Fier-Çifçi	44	40.72	19.57
Patos	44	40.68	19.62
Korçë	46	40.62	20.78
Fier	44	40.72	19.56
#AM
Yerevan	11	40.18	44.51
Gyumri	07	40.79	43.85
Vanadzor	06	40.8	44.49
#AO
Luanda	20	-8.84	13.23
N’dalatando	05	-9.3	14.91
Huambo	08	-12.78	15.74
Lobito	01	-12.36	13.54
Benguela	01	-12.58	13.41
Cuito	02	-12.38	16.93
Lubango	09	-14.92	13.49
Malanje	12	-9.54	16.34
Namibe	13	-15.2	12.15
Soio	16	-6.13	12.37
Cabinda	03	-5.55	12.2
Uíge	15	-7.61	15.06
#AR
Buenos Aires	07	-34.61	-58.38
Córdoba	05	-31.41	-64.18
Rosario	21	-32.95	-60.64
Mendoza	13	-32.89	-68.83
San Miguel de Tucumán	24	-26.82	-65.22
La Plata	01	-34.92	-57.95
Mar del Plata	01	-38	-57.56
Salta	17	-24.79	-65.41
Santa Fe	21	-31.65	-60.71
San Juan	18	-31.54	-68.54
Resistencia	03	-27.46	-58.98
Santiago del Estero	22	-27.8	-64.26
Corrientes	06	-27.47	-58.83
Posadas	14	-27.37	-55.9
Morón	01	-34.65	-58.62
San Salvador de Jujuy	10	-24.19	-65.3
Bahía Blanca	01	-38.72	-62.27
Paraná	08	-31.73	-60.53
Merlo	01	-34.67	-58.73
Neuquén	15	-38.95	-68.06
José C. Paz	01	-34.52	-58.77
Quilmes	01	-34.73	-58.26
Pilar	01	-34.46	-58.91
Formosa	09	-26.18	-58.17
San Fernando del Valle de Catamarca	02	-28.47	-65.79
San Luis	19	-33.3	-66.34
Berazategui	01	-34.77	-58.21
La Rioja	12	-29.41	-66.85
San Miguel	01	-34.54	-58.71
Río Cuarto	05	-33.13	-64.35
Balvanera	07	-34.61	-58.4
Concordia	08	-31.39	-58.02
Comodoro Rivadavia	04	-45.86	-67.5
Belgrano	07	-34.56	-58.46
San Nicolás de los Arroyos	01	-33.33	-60.21
Villa Lugano	07	-34.68	-58.47
Santa Rosa	11	-36.62	-64.28
San Rafael	13	-34.62	-68.33
Tandil	01	-37.32	-59.13
Villa Mercedes	19	-33.68	-65.46
San Carlos de Bariloche	16	-41.15	-71.31
Trelew	04	-43.25	-65.31
Villa María	05	-32.41	-63.24
Reconquista	21	-29.15	-59.65
Zárate	01	-34.1	-59.03
Rafaela	21	-31.25	-61.49
Pergamino	01	-33.89	-60.57
Olavarría	01	-36.89	-60.32
Río Gallegos	20	-51.62	-69.22
Junín	01	-34.58	-60.94
San Martín	13	-33.08	-68.47
Presidencia Roque Sáenz Peña	03	-26.79	-60.44
Luján	01	-34.57	-59.1
Campana	01	-34.16	-58.96
Necochea	01	-38.55	-58.74
Gualeguaychú	08	-33.01	-58.52
Barracas	07	-34.65	-58.38
Cipolletti	16	-38.93	-67.99
Gobernador Gálvez	21	-33.03	-60.64
San Ramón de la Nueva Orán	17	-23.14	-64.32
Chimbas	18	-31.48	-68.53
General Roca	16	-39.03	-67.58
Venado Tuerto	21	-33.75	-61.97
Goya	06	-29.14	-59.26
Villa Carlos Paz	05	-31.42	-64.5
Concepción del Uruguay	08	-32.48	-58.23
Don Torcuato	01	-34.49	-58.63
Puerto Madryn	04	-42.77	-65.04
Tartagal	17	-22.52	-63.8
Hurlingham	01	-34.59	-58.63
Santo Tomé	21	-31.66	-60.77
San Francisco	05	-31.43	-62.08
San Pedro de Jujuy	10	-24.23	-64.87
Ushuaia	23	-54.81	-68.32
Punta Alta	01	-38.88	-62.07
General Pico	11	-35.66	-63.76
Colegiales	07	-34.57	-58.45
Oberá	14	-27.49	-55.12
Chivilcoy	01	-34.9	-60.02
Puerto Eldorado	14	-26.41	-54.69
Azul	01	-36.78	-59.86
Río Tercero	05	-32.17	-64.11
Los Polvorines	01	-34.5	-58.71
Mercedes	01	-34.65	-59.43
Río Grande	23	-53.79	-67.71
Barranqueras	03	-27.48	-58.94
Yerba Buena	24	-26.82	-65.32
#AT
Vienna	09	48.21	16.37
Graz	06	47.07	15.45
Linz	04	48.31	14.29
Favoriten	09	48.16	16.38
Donaustadt	09	48.23	16.46
Floridsdorf	09	48.25	16.4
Salzburg	05	47.8	13.04
Innsbruck	07	47.26	11.39
Ottakring	09	48.22	16.3
Simmering	09	48.18	16.43
Meidling	09	48.17	16.33
Klagenfurt am Wörthersee	02	46.62	14.31
Villach	02	46.61	13.86
Hernals	09	48.23	16.27
Hietzing	09	48.19	16.3
#AU
Sydney	02	-33.87	151.21
Melbourne	07	-37.81	144.96
Brisbane	04	-27.47	153.03
Perth	08	-31.95	115.86
Adelaide	05	-34.93	138.6
Gold Coast	04	-28	153.43
Canberra	01	-35.28	149.13
Newcastle	02	-32.93	151.78
Wollongong	02	-34.42	150.89
Logan City	04	-27.64	153.11
Geelong	07	-38.15	144.36
Hobart	06	-42.88	147.33
Townsville	04	-19.27	146.81
Cairns	04	-16.92	145.77
Toowoomba	04	-27.56	151.95
Darwin	03	-12.46	130.84
Rockingham	08	-32.28	115.73
Launceston	06	-41.44	147.13
Bendigo	07	-36.76	144.28
Ballarat	07	-37.57	143.85
Mandurah	08	-32.53	115.72
Mackay	04	-21.15	149.17
Bundaberg	04	-24.87	152.35
Bunbury	08	-33.33	115.64
Maitland	02	-32.73	151.56
Rockhampton	04	-23.38	150.51
Adelaide Hills	05	-34.91	138.71
Melbourne City Centre	07	-37.82	144.97
Hervey Bay	04	-25.29	152.77
Reservoir	07	-37.72	145
Craigieburn	07	-37.6	144.95
#AZ
Baku	09	40.38	49.89
Ganja	20	40.68	46.36
Sumqayıt	54	40.59	49.67
Lankaran	29	38.75	48.85
Yevlakh	68	40.62	47.15
Mingelchaur	33	40.76	47.06
Saatlı	45	39.93	48.37
Qaraçuxur	09	40.4	49.97
Şirvan	07	39.94	48.93
Bakıxanov	09	40.42	49.97
Nakhchivan	35	39.21	45.41
Sheki	48	41.19	47.17
Xankandi	61	39.82	46.75
#BA
Sarajevo	01	43.85	18.36
Banja Luka	02	44.78	17.19
Zenica	01	44.2	17.9
Tuzla	01	44.54	18.67
Mostar	01	43.34	17.81
Bihać	01	44.82	15.87
#BB
Bridgetown	08	13.11	-59.62
#BD
Dhaka	81	23.71	90.41
Chittagong	84	22.34	91.83
Khulna	82	22.81	89.56
Rājshāhi	83	24.37	88.6
Comilla	84	23.46	91.19
Shibganj	83	25	89.32
Natore	83	24.41	88.99
Rangpur	87	25.75	89.25
Tungi	81	23.89	90.4
Narsingdi	81	23.92	90.72
Bagerhat	82	22.66	89.79
Cox’s Bāzār	84	21.44	92.01
Jessore	82	23.17	89.21
Nāgarpur	81	24.06	89.88
Sylhet	86	24.9	91.87
Mymensingh	H	24.76	90.41
Nārāyanganj	81	23.61	90.5
Bogra	83	24.85	89.37
Dinājpur	87	25.63	88.64
Barisāl	85	22.7	90.37
Saidpur	83	25.78	88.89
Pār Naogaon	83	24.8	88.95
Pābna	83	24.01	89.24
Paltan	81	23.74	90.41
Tāngāil	81	24.25	89.92
Jamālpur	H	24.92	89.95
Puthia	83	24.37	88.83
Nawābganj	83	24.59	88.27
Kushtia	82	23.9	89.12
Sonārgaon	81	23.65	90.62
Sātkhira	82	22.71	89.07
Sirajganj	83	24.46	89.71
Farīdpur	81	23.61	89.84
Sherpur	H	25.02	90.02
Bhairab Bāzār	81	24.05	90.98
Shāhzādpur	83	24.18	89.6
Bhola	85	22.69	90.64
Azimpur	81	23.73	90.39
Kishorganj	81	24.44	90.78
Bibir Hat	84	22.68	91.79
Habiganj	86	24.38	91.41
Mādārīpur	81	23.17	90.21
Feni	84	23.01	91.4
Lākshām	84	23.24	91.12
Ishurdi	83	24.13	89.07
Sarishābāri	H	24.75	89.83
Netrakona	H	24.88	90.73
Joypur Hāt	83	25.1	89.03
Thākurgaon	87	26.03	88.47
Pālang	81	23.22	90.35
Lalmonirhat	87	25.92	89.45
Rāipur	84	23.04	90.77
Tungipāra	81	22.9	89.9
Lakshmīpur	84	22.94	90.83
Maulavi Bāzār	86	24.49	91.77
Joymontop	81	23.79	90.16
Rāmganj	84	23.1	90.85
Narail	82	23.16	89.5
Pirojpur	85	22.58	89.98
Sandwīp	84	22.51	91.45
Sātkania	84	22.08	92.05
Patiya	84	22.3	91.98
Khagrachhari	84	23.11	91.97
#BE
Brussels	BRU	50.85	4.35
Antwerpen	VLG	51.22	4.4
Gent	VLG	51.05	3.72
Charleroi	WAL	50.41	4.44
Liège	WAL	50.63	5.57
Brugge	VLG	51.21	3.22
Namur	WAL	50.47	4.87
Leuven	VLG	50.88	4.7
Mons	WAL	50.45	3.95
Deurne	VLG	51.22	4.47
Aalst	VLG	50.94	4.04
Mechelen	VLG	51.03	4.48
La Louvière	WAL	50.49	4.19
Kortrijk	VLG	50.83	3.26
Hasselt	VLG	50.93	5.34
Ostend	VLG	51.22	2.93
Sint-Niklaas	VLG	51.17	4.14
Tournai	WAL	50.61	3.39
Genk	VLG	50.97	5.5
Seraing	WAL	50.58	5.5
Roeselare	VLG	50.95	3.12
Verviers	WAL	50.59	5.86
Mouscron	WAL	50.74	3.21
#BF
Ouagadougou	03	12.37	-1.53
Bobo-Dioulasso	09	11.18	-4.3
Koudougou	06	12.25	-2.36
Ouahigouya	10	13.58	-2.42
Banfora	02	10.63	-4.77
#BG
Sofia	42	42.7	23.32
Plovdiv	51	42.15	24.75
Varna	61	43.22	27.92
Burgas	39	42.51	27.47
Ruse	53	43.85	25.95
Stara Zagora	59	42.43	25.64
Pleven	50	43.42	24.62
Sliven	56	42.69	26.33
Dobrich	40	43.57	27.83
Shumen	54	43.27	26.92
Pernik	49	42.6	23.03
Yambol	65	42.48	26.5
Haskovo	43	41.93	25.56
Pazardzhik	48	42.2	24.33
Blagoevgrad	38	42.02	23.1
Veliko Tŭrnovo	62	43.08	25.63
Gabrovo	41	42.87	25.33
Vratsa	64	43.21	23.56
Kazanlak	59	42.62	25.4
Vidin	63	43.99	22.88
Asenovgrad	51	42.02	24.87
Kardzhali	44	41.65	25.37
#BH
Manama	16	26.23	50.59
Al Muharraq	15	26.26	50.61
Ar Rifā‘	17	26.13	50.56
Dār Kulayb	17	26.07	50.5
Madīnat Ḩamad	19	26.12	50.51
#BI
Bujumbura	24	-3.38	29.36
Muyinga	18	-2.85	30.34
#BJ
Cotonou	14	6.37	2.42
Abomey-Calavi	09	6.45	2.36
Djougou	13	9.71	1.67
Porto-Novo	16	6.5	2.6
Parakou	10	9.34	2.63
Bohicon	18	7.18	2.07
Kandi	07	11.13	2.94
Lokossa	15	6.64	1.72
Ouidah	09	6.36	2.09
Abomey	18	7.18	1.99
Natitingou	08	10.3	1.38
Savé	11	8.03	2.49
Nikki	10	9.94	3.21
#BN
Bandar Seri Begawan	02	4.89	114.94
#BO
Santa Cruz de la Sierra	08	-17.79	-63.18
Cochabamba	02	-17.39	-66.16
La Paz	04	-16.5	-68.15
Sucre	01	-19.03	-65.26
Oruro	05	-17.98	-67.15
Tarija	09	-21.54	-64.73
Potosí	07	-19.58	-65.75
Sacaba	02	-17.4	-66.04
Montero	08	-17.34	-63.25
Quillacollo	02	-17.39	-66.28
Trinidad	03	-14.83	-64.9
Yacuiba	09	-22.02	-63.68
Riberalta	03	-11.01	-66.06
Tiquipaya	02	-17.34	-66.22
#BR
São Paulo	27	-23.55	-46.64
Rio de Janeiro	21	-22.91	-43.18
Salvador	05	-12.97	-38.51
Fortaleza	06	-3.72	-38.54
Belo Horizonte	15	-19.92	-43.94
Brasília	07	-15.78	-47.93
Curitiba	18	-25.43	-49.27
Manaus	04	-3.1	-60.02
Recife	30	-8.05	-34.88
Belém	16	-1.46	-48.5
Porto Alegre	23	-30.03	-51.23
Goiânia	29	-16.68	-49.25
Guarulhos	27	-23.46	-46.53
Campinas	27	-22.91	-47.06
Nova Iguaçu	21	-22.76	-43.45
Maceió	02	-9.67	-35.74
São Luís	13	-2.53	-44.3
Duque de Caxias	21	-22.79	-43.31
Natal	22	-5.79	-35.21
Teresina	20	-5.09	-42.8
São Bernardo do Campo	27	-23.69	-46.56
Campo Grande	11	-20.44	-54.65
Jaboatão	30	-8.18	-35
Osasco	27	-23.53	-46.79
Santo André	27	-23.66	-46.54
João Pessoa	17	-7.11	-34.86
Jaboatão dos Guararapes	30	-8.11	-35.01
Contagem	15	-19.93	-44.05
Ribeirão Preto	27	-21.18	-47.81
São José dos Campos	27	-23.18	-45.89
Uberlândia	15	-18.92	-48.28
Sorocaba	27	-23.5	-47.46
Cuiabá	14	-15.6	-56.1
Aparecida de Goiânia	29	-16.82	-49.24
Aracaju	28	-10.91	-37.07
Feira de Santana	05	-12.27	-38.97
Londrina	18	-23.31	-51.16
Juiz de Fora	15	-21.76	-43.35
Belford Roxo	21	-22.76	-43.4
Joinville	26	-26.3	-48.85
Niterói	21	-22.88	-43.1
São João de Meriti	21	-22.8	-43.37
Ananindeua	16	-1.37	-48.37
Florianópolis	26	-27.6	-48.55
Santos	27	-23.96	-46.33
Ribeirão das Neves	15	-19.77	-44.09
Vila Velha	08	-20.33	-40.29
Serra	08	-20.13	-40.31
Diadema	27	-23.69	-46.62
Campos dos Goytacazes	21	-21.75	-41.33
Mauá	27	-23.67	-46.46
Betim	15	-19.97	-44.2
Caxias do Sul	23	-29.17	-51.18
São José do Rio Preto	27	-20.82	-49.38
Olinda	30	-8.01	-34.86
Carapicuíba	27	-23.52	-46.83
Campina Grande	17	-7.23	-35.88
Piracicaba	27	-22.73	-47.65
Macapá	03	0.04	-51.07
Itaquaquecetuba	27	-23.49	-46.35
Bauru	27	-22.31	-49.06
Montes Claros	15	-16.73	-43.86
Canoas	23	-29.92	-51.18
Mogi das Cruzes	27	-23.52	-46.19
São Vicente	27	-23.96	-46.39
Jundiaí	27	-23.19	-46.88
Pelotas	23	-31.77	-52.34
Anápolis	29	-16.33	-48.95
Vitória	08	-20.32	-40.34
Maringá	18	-23.43	-51.94
Guarujá	27	-23.99	-46.26
Porto Velho	24	-8.76	-63.9
Franca	27	-20.54	-47.4
Blumenau	26	-26.92	-49.07
Foz do Iguaçu	18	-25.55	-54.59
Ponta Grossa	18	-25.09	-50.16
Paulista	30	-7.94	-34.87
Limeira	27	-22.56	-47.4
Viamão	23	-30.08	-51.02
Suzano	27	-23.54	-46.31
Caucaia	06	-3.74	-38.65
Petrópolis	21	-22.5	-43.18
Uberaba	15	-19.75	-47.93
Rio Branco	01	-9.97	-67.81
Cascavel	18	-24.96	-53.46
Novo Hamburgo	23	-29.68	-51.13
Vitória da Conquista	05	-14.87	-40.84
Barueri	27	-23.51	-46.88
Taubaté	27	-23.03	-45.56
Governador Valadares	15	-18.85	-41.95
Praia Grande	27	-24.01	-46.4
Várzea Grande	14	-15.65	-56.13
Volta Redonda	21	-22.52	-44.1
Santa Maria	23	-29.68	-53.81
Santa Luzia	15	-19.77	-43.85
Gravataí	23	-29.94	-50.99
Caruaru	30	-8.28	-35.98
Boa Vista	25	2.82	-60.67
Rio Verde	29	-17.8	-50.93
Ipatinga	15	-19.47	-42.54
Sumaré	27	-22.82	-47.27
Juazeiro do Norte	06	-7.21	-39.32
Embu	27	-23.65	-46.85
Imperatriz	13	-5.53	-47.49
Colombo	18	-25.29	-49.22
Taboão da Serra	27	-23.63	-46.79
Jacareí	27	-23.31	-45.97
Marília	27	-22.21	-49.95
Presidente Prudente	27	-22.13	-51.39
São Leopoldo	23	-29.76	-51.15
Itabuna	05	-14.79	-39.28
São Carlos	27	-22.02	-47.89
Hortolândia	27	-22.86	-47.22
Mossoró	22	-5.19	-37.34
Itapevi	27	-23.55	-46.93
Sete Lagoas	15	-19.47	-44.25
São José	26	-28.21	-49.16
Palmas	31	-10.17	-48.33
Parauapebas	16	-6.07	-49.9
Americana	27	-22.74	-47.33
Petrolina	30	-9.4	-40.5
Divinópolis	15	-20.14	-44.89
Maracanaú	06	-3.88	-38.63
Planaltina	07	-15.62	-47.65
Santarém	16	-2.44	-54.71
Camaçari	05	-12.7	-38.32
Santa Bárbara d'Oeste	27	-22.75	-47.41
Rio Grande	23	-32.03	-52.1
Cachoeiro de Itapemirim	08	-20.85	-41.11
Itaboraí	21	-22.74	-42.86
Rio Claro	27	-22.41	-47.56
Indaiatuba	27	-23.09	-47.21
Passo Fundo	23	-28.26	-52.41
Cotia	27	-23.6	-46.92
Francisco Morato	27	-23.28	-46.75
Araçatuba	27	-21.21	-50.43
Araraquara	27	-21.79	-48.18
Ferraz de Vasconcelos	27	-23.54	-46.37
Arapiraca	02	-9.75	-36.66
Lages	26	-27.82	-50.33
Barra Mansa	21	-22.54	-44.17
Nossa Senhora do Socorro	28	-10.85	-37.13
Dourados	11	-22.22	-54.81
Criciúma	26	-28.68	-49.37
Chapecó	26	-27.1	-52.62
Barreiras	05	-12.15	-44.99
Sobral	06	-3.69	-40.35
Itajaí	26	-26.91	-48.66
Ilhéus	05	-14.79	-39.04
Angra dos Reis	21	-23.01	-44.32
Nova Friburgo	21	-22.28	-42.53
Rondonópolis	14	-16.47	-54.64
Itapecerica da Serra	27	-23.72	-46.85
Guarapuava	18	-25.39	-51.47
Parnamirim	22	-5.92	-35.26
Caxias	13	-4.86	-43.36
Nilópolis	21	-22.81	-43.41
Poços de Caldas	15	-21.79	-46.56
Marabá	16	-5.38	-49.13
Luziânia	29	-16.25	-47.95
Cabo	30	-8.28	-35.03
Macaé	21	-22.38	-41.78
Ibirité	15	-20.02	-44.06
Lauro de Freitas	05	-12.89	-38.33
Paranaguá	18	-25.52	-48.53
Parnaíba	20	-2.9	-41.78
Itu	27	-23.26	-47.3
Castanhal	16	-1.29	-47.93
São Caetano do Sul	27	-23.62	-46.55
Queimados	21	-22.72	-43.56
Pindamonhangaba	27	-22.92	-45.46
Sapucaia	23	-29.83	-51.15
Jaraguá do Sul	26	-26.49	-49.07
Mogi Guaçu	27	-22.37	-46.95
Jequié	05	-13.86	-40.09
Itapetininga	27	-23.59	-48.05
Patos de Minas	15	-18.58	-46.52
Bragança Paulista	27	-22.95	-46.54
Timon	13	-5.09	-42.84
São José dos Pinhais	18	-25.53	-49.21
Teresópolis	21	-22.42	-42.98
Uruguaiana	23	-29.75	-57.09
Porto Seguro	05	-16.45	-39.06
Alagoinhas	05	-12.14	-38.42
Palhoça	26	-27.65	-48.67
Barbacena	15	-21.23	-43.77
Cachoeirinha	23	-29.95	-51.09
Santa Rita	17	-7.11	-34.98
Toledo	18	-24.71	-53.74
Jaú	27	-22.3	-48.56
Cubatão	27	-23.89	-46.43
Pinhais	18	-25.44	-49.19
Simões Filho	05	-12.78	-38.4
Varginha	15	-21.55	-45.43
Sinop	14	-11.86	-55.5
Pouso Alegre	15	-22.23	-45.94
Eunápolis	05	-16.38	-39.58
Botucatu	27	-22.89	-48.44
Jandira	27	-23.53	-46.9
Ribeirão Pires	27	-23.71	-46.41
Conselheiro Lafaiete	15	-20.66	-43.79
Resende	21	-22.47	-44.45
Araucária	18	-25.59	-49.41
Atibaia	27	-23.12	-46.55
Várzea Paulista	27	-23.21	-46.83
Garanhuns	30	-8.88	-36.5
Araruama	21	-22.87	-42.34
Catanduva	27	-21.14	-48.97
Franco da Rocha	27	-23.32	-46.73
Cabo Frio	21	-22.89	-42.03
Ji Paraná	24	-10.89	-61.95
Araras	27	-22.36	-47.38
Poá	27	-23.53	-46.34
Vitória de Santo Antão	30	-8.12	-35.29
Umuarama	18	-23.77	-53.32
Apucarana	18	-23.55	-51.46
Santa Cruz do Sul	23	-29.72	-52.43
Guaratinguetá	27	-22.82	-45.19
Linhares	08	-19.39	-40.07
Araguaína	31	-7.19	-48.21
Esmeraldas	15	-19.76	-44.31
Birigui	27	-21.29	-50.34
Assis	27	-22.66	-50.41
Barretos	27	-20.56	-48.57
Colatina	08	-19.54	-40.63
Teófilo Otoni	15	-17.86	-41.51
Guaíba	23	-30.11	-51.32
Guarapari	08	-20.67	-40.5
Coronel Fabriciano	15	-19.52	-42.63
Itaguaí	21	-22.85	-43.78
Rio das Ostras	21	-22.53	-41.94
Itabira	15	-19.62	-43.23
Votorantim	27	-23.55	-47.44
Sertãozinho	27	-21.14	-47.99
Santana de Parnaíba	27	-23.44	-46.92
Bagé	23	-31.33	-54.11
Passos	15	-20.72	-46.61
Salto	27	-23.2	-47.29
Ubá	15	-21.12	-42.94
Ourinhos	27	-22.98	-49.87
Trindade	29	-16.65	-49.49
Arapongas	18	-23.42	-51.42
Araguari	15	-18.65	-48.19
Corumbá	11	-19.01	-57.65
Erechim	23	-27.63	-52.28
Japeri	21	-22.64	-43.65
Vespasiano	15	-19.69	-43.92
Campo Largo	18	-25.46	-49.53
Tatuí	27	-23.36	-47.86
Patos	17	-7.02	-37.28
Timóteo	15	-19.58	-42.65
Muriaé	15	-21.13	-42.37
Cambé	18	-23.28	-51.28
Bayeux	17	-7.12	-34.93
Bento Gonçalves	23	-29.17	-51.52
Caraguatatuba	27	-23.62	-45.41
Itanhaém	27	-24.18	-46.79
Santana do Livramento	23	-30.89	-55.53
Almirante Tamandaré	18	-25.32	-49.31
Planaltina	29	-15.45	-47.61
Crato	06	-7.23	-39.41
Valinhos	27	-22.97	-47
São Lourenço da Mata	30	-8	-35.02
Nova Lima	15	-19.99	-43.85
Brusque	26	-27.1	-48.91
Barra do Piraí	21	-22.47	-43.83
Alegrete	23	-29.78	-55.79
Caieiras	27	-23.36	-46.74
Barra do Corda	13	-5.51	-45.24
Igarassu	30	-7.83	-34.91
Paulo Afonso	05	-9.41	-38.21
Ituiutaba	15	-18.97	-49.46
Esteio	23	-29.86	-51.18
Sarandi	18	-23.44	-51.87
Itaperuna	21	-21.2	-41.89
Santana	03	-0.06	-51.18
Jardim Paulista	27	-23.57	-46.66
Codó	13	-4.46	-43.89
Araxá	15	-19.59	-46.94
Redenção	16	-8.03	-50.03
Abreu e Lima	30	-7.91	-34.9
Itajubá	15	-22.43	-45.45
Lavras	15	-21.25	-45
Avaré	27	-23.1	-48.93
Formosa	29	-15.54	-47.33
Leme	27	-22.19	-47.39
Cruzeiro do Sul	01	-7.63	-72.68
Itumbiara	29	-18.42	-49.22
Maricá	21	-22.92	-42.82
Ubatuba	27	-23.43	-45.07
Três Lagoas	11	-20.79	-51.7
São João del Rei	15	-21.14	-44.26
Mogi Mirim	27	-22.43	-46.96
Abaetetuba	16	-1.72	-48.88
São Bento do Sul	26	-26.25	-49.38
Itaúna	15	-20.08	-44.58
São Mateus	08	-18.72	-39.86
Jataí	29	-17.88	-51.72
São João da Boa Vista	27	-21.97	-46.8
Lorena	27	-22.73	-45.12
Santa Cruz do Capibaribe	30	-7.96	-36.2
São Sebastião	27	-23.76	-45.41
Tucuruí	16	-3.77	-49.68
Embu Guaçu	27	-23.83	-46.81
Sapiranga	23	-29.64	-51.01
Pará de Minas	15	-19.86	-44.61
Campo Mourão	18	-24.04	-52.38
Cachoeira do Sul	23	-30.04	-52.89
Santo Antônio de Jesus	05	-12.97	-39.26
Paranavaí	18	-23.07	-52.47
João Monlevade	15	-19.81	-43.17
Matão	27	-21.6	-48.37
Bacabal	13	-4.29	-44.79
Caçapava	27	-23.1	-45.71
Arujá	27	-23.4	-46.32
Cruzeiro	27	-22.57	-44.97
Patrocínio	15	-18.94	-46.99
Três Rios	21	-22.12	-43.21
Bebedouro	27	-20.95	-48.48
São Cristóvão	28	-11.01	-37.21
Alfenas	15	-21.43	-45.95
Ijuí	23	-28.39	-53.91
Altamira	16	-3.2	-52.21
Paracatu	15	-17.22	-46.87
Carpina	30	-7.85	-35.25
Iguatu	06	-6.36	-39.3
Votuporanga	27	-20.42	-49.97
Paragominas	16	-2.97	-47.48
Lins	27	-21.68	-49.74
Jaboticabal	27	-21.25	-48.32
Viçosa	15	-20.75	-42.88
São Sebastião do Paraíso	15	-20.92	-46.99
Balsas	13	-7.53	-46.04
Itatiba	27	-23.01	-46.84
Santa Inês	13	-3.67	-45.38
Tubarão	26	-28.47	-49.01
Pato Branco	18	-26.23	-52.67
Paulínia	27	-22.76	-47.15
Lajeado	23	-29.47	-51.96
Cruz Alta	23	-28.64	-53.61
Aquiraz	06	-3.9	-38.39
Itacoatiara	04	-3.14	-58.44
Gurupi	31	-11.73	-49.07
Itaituba	16	-4.28	-55.98
Santo Ângelo	23	-28.3	-54.26
Parintins	04	-2.63	-56.74
Curvelo	15	-18.76	-44.43
Itabaiana	28	-10.68	-37.43
Caçador	26	-26.78	-51.01
Ouro Preto	15	-20.39	-43.51
Caldas Novas	29	-17.74	-48.63
Irecê	05	-11.3	-41.86
Catalão	29	-18.17	-47.95
Três Corações	15	-21.7	-45.25
Rio Largo	02	-9.48	-35.85
Valença	05	-13.37	-39.07
Vilhena	24	-12.74	-60.15
Peruíbe	27	-24.32	-47
Itapeva	27	-23.98	-48.88
Cataguases	15	-21.39	-42.7
Saquarema	21	-22.92	-42.51
Tupã	27	-21.93	-50.51
Fernandópolis	27	-20.28	-50.25
Senador Canedo	29	-16.71	-49.09
Itapira	27	-22.44	-46.82
Gravatá	30	-8.2	-35.56
Valença	21	-22.25	-43.7
Pirassununga	27	-22	-47.43
Unaí	15	-16.36	-46.91
Caratinga	15	-19.79	-42.14
Itapetinga	05	-15.25	-40.25
Mococa	27	-21.47	-47
São Borja	23	-28.66	-56
Carazinho	23	-28.28	-52.79
Santa Rosa	23	-27.87	-54.48
Telêmaco Borba	18	-24.32	-50.62
Guanambi	05	-14.22	-42.78
Aracruz	08	-19.82	-40.27
Ariquemes	24	-9.91	-63.04
Farroupilha	23	-29.22	-51.35
Francisco Beltrão	18	-26.08	-53.05
Picos	20	-7.08	-41.47
Lençóis Paulista	27	-22.6	-48.8
Bragança	16	-1.05	-46.77
Arcoverde	30	-8.42	-37.05
Vacaria	23	-28.51	-50.93
Cajamar	27	-23.36	-46.88
Janaúba	15	-15.8	-43.31
Vinhedo	27	-23.03	-46.98
Formiga	15	-20.46	-45.43
Cianorte	18	-23.66	-52.6
Itapipoca	06	-3.49	-39.58
Ponta Porã	11	-22.54	-55.73
Estância	28	-11.27	-37.44
Cacoal	24	-11.44	-61.45
São Gabriel	23	-30.34	-54.32
Concórdia	26	-27.23	-52.03
Pacatuba	06	-3.98	-38.62
Viana	08	-20.39	-40.5
São Pedro da Aldeia	21	-22.84	-42.1
Caicó	22	-6.46	-37.1
Seropédica	21	-22.74	-43.71
Cabedelo	17	-6.98	-34.83
Manhuaçu	15	-20.26	-42.03
Penápolis	27	-21.42	-50.08
Mairiporã	27	-23.32	-46.59
Montenegro	23	-29.69	-51.46
Ipojuca	30	-8.4	-35.06
Campos do Jordão	27	-22.74	-45.59
Camaquã	23	-30.85	-51.81
Crateús	06	-5.18	-40.68
Manacapuru	04	-3.3	-60.62
Andradina	27	-20.9	-51.38
Barra do Garças	14	-15.89	-52.26
Cascavel	06	-4.13	-38.24
Biguaçu	26	-27.49	-48.66
Batatais	27	-20.89	-47.58
Rio do Sul	26	-27.21	-49.64
Pirapora	15	-17.34	-44.94
Içara	26	-28.71	-49.3
Bezerros	30	-8.23	-35.8
Serra Talhada	30	-7.99	-38.3
Horizonte	06	-4.1	-38.48
Rolândia	18	-23.31	-51.37
Marechal Deodoro	02	-9.71	-35.9
São Roque	27	-23.53	-47.14
Coari	04	-4.08	-63.14
Taquaritinga	27	-21.41	-48.5
#BS
Nassau	23	25.06	-77.34
#BT
Thimphu	20	27.47	89.64
#BW
Gaborone	14	-24.65	25.91
Francistown	13	-21.17	27.51
Molepolole	06	-24.41	25.5
Selebi-Phikwe	17	-21.98	27.84
#BY
Minsk	04	53.9	27.57
Homyel'	02	52.43	30.98
Mahilyow	06	53.92	30.34
Vitebsk	07	55.19	30.2
Hrodna	03	53.69	23.83
Brest	01	52.1	23.69
Babruysk	06	53.14	29.22
Baranovichi	01	53.13	26.01
Barysaw	05	54.23	28.51
Pinsk	01	52.12	26.1
Orsha	07	54.51	30.42
Mazyr	02	52.05	29.25
Salihorsk	05	52.79	27.54
Maladzyechna	05	54.32	26.85
Navapolatsk	07	55.53	28.6
Lida	03	53.88	25.3
Polatsk	07	55.49	28.79
Zhlobin	02	52.89	30.02
Svyetlahorsk	02	52.63	29.74
Rechytsa	02	52.36	30.39
Slutsk	05	53.03	27.56
Horad Zhodzina	05	54.1	28.33
Slonim	03	53.09	25.32
Kobryn	01	52.21	24.36
#BZ
Belize City	01	17.5	-88.2
#CA
Toronto	08	43.7	-79.42
Montréal	10	45.51	-73.59
Calgary	01	51.05	-114.09
Ottawa	08	45.41	-75.7
Edmonton	01	53.55	-113.47
Mississauga	08	43.58	-79.66
North York	08	43.77	-79.42
Winnipeg	03	49.88	-97.15
Vancouver	02	49.25	-123.12
Scarborough	08	43.77	-79.26
Québec	10	46.81	-71.21
Hamilton	08	43.25	-79.85
Brampton	08	43.68	-79.77
Surrey	02	49.11	-122.83
Laval	10	45.57	-73.69
Halifax	07	44.65	-63.57
Etobicoke	08	43.65	-79.57
London	08	42.98	-81.23
Oshawa	08	43.9	-78.85
Okanagan	02	50.36	-119.35
Victoria	02	48.44	-123.35
Windsor	08	42.3	-83.02
Markham	08	43.87	-79.27
Gatineau	10	45.48	-75.7
Vaughan	08	43.84	-79.5
Kitchener	08	43.43	-80.51
Longueuil	10	45.53	-73.52
Burnaby	02	49.27	-122.95
Ladner	02	49.09	-123.08
Saskatoon	11	52.13	-106.67
Richmond Hill	08	43.87	-79.44
Barrie	08	44.4	-79.67
Richmond	02	49.17	-123.14
Nepean	08	45.34	-75.72
Regina	11	50.45	-104.62
Oakville	08	43.45	-79.68
Burlington	08	43.39	-79.84
Greater Sudbury	08	46.49	-80.99
Abbotsford	02	49.06	-122.25
Saguenay	10	48.42	-71.07
Coquitlam	02	49.28	-122.78
St. Catharines	08	43.17	-79.24
Sherbrooke	10	45.4	-71.9
Lévis	10	46.8	-71.18
Kelowna	02	49.88	-119.49
Cambridge	08	43.36	-80.31
Trois-Rivières	10	46.35	-72.55
Guelph	08	43.55	-80.26
East York	08	43.69	-79.33
Kingston	08	44.23	-76.48
Moncton	04	46.09	-64.8
Sydney	07	46.14	-60.18
Milton	08	43.52	-79.88
Delta	02	49.14	-122.91
Dartmouth	07	44.67	-63.58
Thunder Bay	08	48.38	-89.25
St. John's	05	47.56	-52.71
Waterloo	08	43.47	-80.52
Terrebonne	10	45.7	-73.65
Ajax	08	43.85	-79.03
Kanata	08	45.3	-75.92
Saint John	04	45.27	-66.06
Pickering	08	43.9	-79.13
Brantford	08	43.13	-80.27
Nanaimo	02	49.17	-123.94
Niagara Falls	08	43.1	-79.07
Willowdale	08	43.77	-79.4
Saint-Laurent	10	45.5	-73.67
Chilliwack	02	49.17	-121.95
Repentigny	10	45.74	-73.45
Fort McMurray	01	56.73	-111.38
Peterborough	08	44.3	-78.32
Newmarket	08	44.05	-79.47
La Haute-Saint-Charles	10	46.89	-71.37
Red Deer	01	52.27	-113.8
Saint-Léonard	10	45.59	-73.6
Sarnia	08	42.98	-82.4
Saint-Jean-sur-Richelieu	10	45.31	-73.26
Lethbridge	01	49.7	-112.82
Maple Ridge	02	49.22	-122.6
Brossard	10	45.45	-73.47
Kamloops	02	50.67	-120.32
Notre-Dame-de-Grâce	10	45.48	-73.61
White Rock	02	49.02	-122.8
Sault Ste. Marie	08	46.52	-84.33
Prince George	02	53.92	-122.75
Medicine Hat	01	50.04	-110.68
Norfolk County	08	42.83	-80.38
Drummondville	10	45.88	-72.48
New Westminster	02	49.21	-122.91
Port Coquitlam	02	49.27	-122.77
St. Albert	01	53.63	-113.64
Aurora	08	44	-79.47
Sherwood Park	01	53.52	-113.32
Saint-Jérôme	10	45.78	-74
Jonquière	10	48.42	-71.25
Granby	10	45.4	-72.73
Fredericton	04	45.95	-66.67
North Bay	08	46.32	-79.47
Welland	08	42.98	-79.25
Saint-Hyacinthe	10	45.63	-72.96
#CD
Kinshasa	06	-4.33	15.31
Lubumbashi	14	-11.66	27.48
Mbuji-Mayi	04	-6.14	23.59
Kisangani	30	0.52	25.19
Masina	06	-4.38	15.39
Kananga	23	-5.9	22.42
Likasi	14	-10.98	26.74
Kolwezi	22	-10.71	25.47
Tshikapa	18	-6.42	20.8
Beni	11	0.49	29.47
Bukavu	12	-2.49	28.84
Mwene-Ditu	21	-7.01	23.45
Kikwit	20	-5.04	18.82
Mbandaka	02	0.05	18.26
Matadi	08	-5.84	13.46
Uvira	12	-3.4	29.14
Boma	08	-5.85	13.05
Butembo	11	0.14	29.29
Gandajika	04	-6.75	23.95
Kalemie	29	-5.95	29.19
Goma	11	-1.67	29.23
Kindu	10	-2.94	25.92
Isiro	16	2.77	27.62
Bandundu	20	-3.32	17.38
Gemena	02	3.26	19.77
Ilebo	18	-4.33	20.59
Bunia	17	1.56	30.25
Bumba	25	2.19	22.47
Mbanza-Ngungu	08	-5.26	14.86
Kamina	15	-8.74	25
Lisala	02	2.15	21.52
Lodja	27	-3.52	23.6
Kipushi	14	-11.76	27.25
Kabinda	04	-6.14	24.48
Kasongo	10	-4.43	26.67
Mweka	18	-4.85	21.56
Gbadolite	26	4.28	21
Buta	13	2.79	24.73
Moanda	08	-5.93	12.37
#CF
Bangui	18	4.36	18.55
Bimbo	17	4.26	18.42
Mbaïki	07	3.87	17.99
Berbérati	04	4.26	15.79
Kaga Bandoro	15	6.99	19.19
#CG
Brazzaville	12	-4.27	15.28
Pointe-Noire	15	-4.78	11.86
Dolisie	07	-4.2	12.67
Kayes	01	-4.2	13.29
#CH
Zürich	ZH	47.37	8.55
Genève	GE	46.2	6.15
Basel	BS	47.56	7.57
Bern	BE	46.95	7.45
Lausanne	VD	46.52	6.63
Winterthur	ZH	47.51	8.72
Sankt Gallen	SG	47.42	9.37
Lugano	TI	46.01	8.96
Luzern	LU	47.05	8.31
Zürich (Kreis 11)	ZH	47.42	8.52
#CI
Abidjan	93	5.35	-4
Abobo	93	5.42	-4.02
Bouaké	90	7.69	-5.03
Daloa	96	6.88	-6.45
San-Pédro	76	4.75	-6.64
Yamoussoukro	81	6.82	-5.28
Korhogo	87	9.46	-5.63
Man	78	7.41	-7.55
Divo	95	5.84	-5.36
Gagnoa	95	6.13	-5.95
Abengourou	94	6.73	-3.5
Anyama	93	5.49	-4.05
Agboville	82	5.93	-4.21
Grand-Bassam	94	5.21	-3.74
Dabou	82	5.33	-4.38
Dimbokro	81	6.65	-4.71
Ferkessédougou	87	9.59	-5.19
Adzopé	82	6.11	-3.86
Bouaflé	96	6.99	-5.74
Sinfra	92	6.62	-5.91
Katiola	90	8.14	-5.1
Bondoukou	92	8.04	-2.8
Danané	78	7.26	-8.15
Oumé	95	6.38	-5.42
Séguéla	97	7.96	-6.67
Bingerville	93	5.36	-3.89
Issia	96	6.49	-6.59
#CL
Santiago	12	-33.46	-70.65
Puente Alto	12	-33.61	-70.58
Antofagasta	03	-23.65	-70.4
Viña del Mar	01	-33.02	-71.55
Valparaíso	01	-33.04	-71.63
Talcahuano	06	-36.72	-73.12
San Bernardo	12	-33.59	-70.7
Temuco	04	-38.74	-72.6
Iquique	15	-20.21	-70.15
Concepción	06	-36.83	-73.05
Rancagua	08	-34.17	-70.74
La Pintana	12	-33.58	-70.63
Talca	11	-35.43	-71.66
Arica	16	-18.47	-70.3
Coquimbo	07	-29.95	-71.34
Puerto Montt	14	-41.47	-72.94
La Serena	07	-29.9	-71.25
Chillán	18	-36.61	-72.1
Calama	03	-22.46	-68.92
Osorno	14	-40.57	-73.13
Valdivia	17	-39.81	-73.25
Quilpué	01	-33.05	-71.44
Copiapó	05	-27.37	-70.33
Los Ángeles	06	-37.47	-72.35
Punta Arenas	10	-53.15	-70.91
Lo Prado	12	-33.44	-70.73
Curicó	11	-34.98	-71.24
Villa Alemana	01	-33.04	-71.37
Coronel	06	-37.03	-73.14
San Antonio	01	-33.59	-71.61
Chiguayante	06	-36.93	-73.03
Ovalle	07	-30.6	-71.2
Linares	11	-35.85	-71.59
Quillota	01	-32.88	-71.25
Peñaflor	12	-33.61	-70.88
Melipilla	12	-33.69	-71.22
San Felipe	01	-32.75	-70.73
Los Andes	01	-32.83	-70.6
Buin	12	-33.73	-70.74
Talagante	12	-33.66	-70.93
#CM
Douala	05	4.05	9.7
Yaoundé	11	3.87	11.52
Garoua	13	9.3	13.4
Kousséri	12	12.08	15.03
Bamenda	07	5.96	10.15
Maroua	12	10.59	14.32
Bafoussam	08	5.48	10.42
Mokolo	12	10.74	13.8
Ngaoundéré	10	7.33	13.58
Bertoua	04	4.58	13.68
Edéa	05	3.8	10.13
Loum	05	4.72	9.74
Kumba	09	4.64	9.45
Nkongsamba	05	4.95	9.94
Mbouda	08	5.63	10.25
Dschang	08	5.44	10.05
Foumban	08	5.73	10.9
Ébolowa	14	2.9	11.15
Guider	13	9.93	13.95
Foumbot	08	5.51	10.63
Bafang	08	5.16	10.18
Yagoua	12	10.34	15.23
Mbalmayo	11	3.52	11.5
Meïganga	10	6.52	14.3
Bali	07	5.89	10.01
Limbe	09	4.02	9.21
Bafia	11	4.75	11.23
Wum	07	6.38	10.07
Bangangté	08	5.14	10.53
Tiko	09	4.08	9.36
Kribi	14	2.94	9.91
Mora	12	11.05	14.14
Sangmélima	14	2.93	11.98
Kumbo	07	6.2	10.67
Nkoteng	11	4.52	12.03
#CN
Shanghai	23	31.22	121.46
Beijing	22	39.91	116.4
Tianjin	28	39.14	117.18
Guangzhou	30	23.12	113.25
Shenzhen	30	22.55	114.07
Wuhan	12	30.58	114.27
Dongguan	30	23.02	113.75
Chongqing	33	29.56	106.55
Chengdu	32	30.67	104.07
Nanjing	04	32.06	118.78
Nanchong	32	30.8	106.08
Xi’an	26	34.26	108.93
Shenyang	19	41.79	123.43
Hangzhou	02	30.29	120.16
Harbin	08	45.75	126.65
Tai’an	25	36.19	117.12
Suzhou	04	31.3	120.6
Shantou	30	23.37	116.71
Jinan	25	36.67	117
Zhengzhou	09	34.76	113.65
Changchun	05	43.88	125.32
Dalian	19	38.91	121.6
Kunming	29	25.04	102.72
Qingdao	25	36.06	120.38
Foshan	30	23.03	113.13
Puyang	02	29.46	119.89
Wuxi	04	31.57	120.29
Xiamen	07	24.48	118.08
Tianshui	15	34.58	105.74
Ningbo	02	29.88	121.55
Shiyan	12	32.65	110.78
Taiyuan	24	37.87	112.56
Tangshan	10	39.63	118.18
Hefei	01	31.86	117.28
Zibo	25	36.79	118.06
Zhongshan	30	21.32	110.57
Changsha	11	28.2	112.97
Ürümqi	13	43.8	87.6
Shijiazhuang	10	38.04	114.48
Lanzhou	15	36.06	103.84
Yunfu	30	22.93	112.04
Nanchang	03	28.68	115.85
Dadonghai	31	18.22	109.51
Ordos	20	39.61	109.78
Jilin	05	43.85	126.56
Bayan Nur	20	40.74	107.39
Kunshan	04	31.38	120.95
Xinyang	09	32.12	114.07
Fushun	19	41.89	123.94
Luoyang	09	34.68	112.45
Guankou	11	28.16	113.63
Handan	10	36.6	114.47
Baotou	20	40.58	110.02
Xuchang	09	34.03	113.86
Yueyang	11	29.37	113.09
Anshan	19	41.12	122.99
Tongshan	04	34.18	117.16
Fuzhou	07	26.06	119.31
Guiyang	18	26.58	106.72
Lijiang	29	26.87	100.22
Datong	24	40.09	113.29
Changshu City	04	31.65	120.74
Xianyang	26	34.34	108.7
Huainan	01	32.63	117
Jieyang	30	23.54	116.37
Zhu Cheng City	25	36	119.4
Baoding	10	38.85	115.49
Benxi	19	41.29	123.77
Changzhou	04	31.77	119.95
Huaibei	01	33.97	116.79
Kaifeng	09	34.8	114.31
Pingdingshan	09	33.74	113.3
Qiqihar	08	47.34	123.96
Wenzhou	02	28	120.67
Zhabei	23	31.26	121.46
Nanning	16	22.82	108.32
Anyang	09	36.1	114.38
Hohhot	20	40.81	111.65
Shangyu	02	30.02	120.87
Xining	06	36.63	101.76
Qinhuangdao	10	39.93	119.59
Hengyang	11	26.89	112.62
Xinxiang	09	35.19	113.8
Hegang	08	47.35	130.3
Langfang	10	39.51	116.69
Zhumadian	09	32.98	114.03
Yantai	25	37.48	121.44
Zhuzhou	11	27.83	113.15
Changzhi	24	35.21	111.74
Zhangjiakou	10	40.81	114.88
Zigong	32	29.34	104.78
Fuxin	19	42.02	121.66
Huangshi	12	30.25	115.05
Liaoyang	19	41.27	123.17
Xiangtan	11	27.85	112.9
Puyang Chengguanzhen	09	35.71	115.01
Nantong	04	32.03	120.87
Mudanjiang	08	44.58	129.6
Guilin	16	25.28	110.29
Zhanjiang	30	21.28	110.34
Zhenjiang	04	32.21	119.46
Dandong	19	40.13	124.39
Shaoguan	30	24.8	113.58
Yancheng	04	33.36	120.16
Panshan	19	41.19	122.05
Haikou	31	20.05	110.34
Taizhou	04	32.49	119.91
Xingtai	10	37.06	114.49
Jinzhou	19	41.11	121.14
Shuangyashan	08	46.64	131.15
Luancheng	10	37.88	114.65
Yingkou	19	40.66	122.23
Zhangzhou	07	24.51	117.66
Bengbu	01	32.94	117.36
Shihezi	13	44.3	86.04
Siping	05	43.16	124.38
Huai'an	04	33.59	119.02
Jiamusi	08	46.8	130.32
Neijiang	32	29.58	105.06
Yangzhou	04	32.4	119.44
Guli	02	28.88	120.03
Tanggu	28	39.02	117.65
Jiangmen	30	22.58	113.08
Cangzhou	10	38.32	116.87
Changde	11	29.03	111.7
Jiaozuo	09	35.24	113.23
Tonghua	05	41.72	125.93
Wuhu	01	31.34	118.37
Zhuhai	30	22.28	113.57
Shashi	12	30.31	112.24
Wuwei	15	37.93	102.63
Jianshui	29	24.28	101.22
Qionghai	31	19.24	110.46
Yichang	12	30.71	111.28
Yinchuan	21	38.47	106.27
Jiaojiang	02	28.7	121.47
Zunyi	18	27.69	106.91
Jiaxing	02	30.75	120.75
Liaoyuan	05	42.9	125.14
Xiangyang	12	32.04	112.14
Dadukou	32	26.55	101.71
Hengshui	10	37.73	115.7
Jining	25	35.41	116.58
Wenshan City	29	23.36	104.25
Chengde	10	40.95	117.96
Bei’an	08	48.27	126.6
Luqiao	02	28.58	121.37
Chaozhou	30	23.65	116.62
Shaoxing	02	30	120.58
Luohe	09	33.56	114.04
Yangquan	24	37.86	113.56
Chaoyang	19	41.57	120.46
Jixi	08	45.3	130.96
Yangjiang	30	21.86	111.96
Weifang	25	36.71	119.1
Xinpu	04	34.6	119.16
Dezhou	25	37.45	116.31
Zhoukou	09	33.63	114.63
Putian	07	25.44	119.01
Zhangjiakou Shi Xuanhua Qu	10	40.61	115.04
Pingxiang	03	27.62	113.85
Fenghuang	11	27.94	109.6
Zhaoqing	30	23.05	112.46
Huocheng	13	44.05	80.87
Anqing	01	30.51	117.05
Anshun	18	26.25	105.93
Chifeng	20	42.27	118.96
Taihecun	08	45.76	130.85
Shiqi	30	22.52	113.39
Aksu	13	41.18	80.28
Tieling	19	42.29	123.84
Jincheng	24	35.5	112.83
Yanji	05	42.91	129.51
Suizhou	12	31.71	113.36
Shangrao	03	28.45	117.94
Baicheng	05	45.61	122.82
Lianshan	19	40.76	120.85
Wusong	01	30.95	117.78
Jingdezhen	03	29.29	117.21
Shengli	25	37.46	118.49
Xinyuan	13	43.43	83.25
Yangshuo	16	24.78	110.49
Xiuying	31	20	110.29
Beihai	16	21.48	109.1
Huizhou	30	23.11	114.42
Chuzhou	01	32.32	118.3
Kashgar	13	39.47	75.99
Linyi	25	35.06	118.34
Chengzhong	12	30.94	113.55
Wuzhou	16	23.48	111.32
Hulan Ergi	08	47.2	123.63
Mianyang	32	31.47	104.68
Tongliao	20	43.61	122.27
Karamay	13	45.58	84.89
Aral	13	40.54	81.27
Jiujiang	03	29.7	116
Jining	20	41.03	113.11
Turpan	13	42.95	89.18
Heze	25	35.24	115.47
Laohekou	12	32.39	111.67
Suihua	08	46.64	127
Liupanshui	18	26.59	104.83
Nanyang	09	32.99	112.53
Wafangdian	19	39.62	122.01
Rizhao	25	35.43	119.46
Ji’an	03	27.12	114.98
Hebi	09	35.9	114.19
Huayin	26	34.57	110.07
Yibin	32	28.76	104.64
Xiantao	12	30.37	113.44
Yuci	24	37.68	112.73
Linfen	24	36.09	111.52
Liaocheng	25	36.46	115.98
Fendou	08	46.64	124.86
Huanggang	30	23.68	117
Jingling	12	30.65	113.1
Tongchuanshi	26	35.07	109.08
Xintai	25	35.9	117.75
Wuxue	12	29.85	115.55
Wuhai	20	39.68	106.82
Guangyuan	32	32.44	105.82
Hailar	20	49.2	119.7
Daliang	30	22.84	113.25
Sanming	07	26.25	117.62
Hangu	28	39.25	117.79
Suzhou	01	33.64	116.98
Gaoping	32	30.78	106.1
Daqing	08	46.58	125
Yiyang	11	28.59	112.33
Linxia Chengguanzhen	15	35.6	103.21
Yuncheng	24	35.02	110.99
Changji	13	44.01	87.3
Kaiyuan	29	23.7	103.3
Mentougou	22	39.94	116.09
Xinhui	30	22.46	113.05
Ezhou	12	30.4	114.83
Humen	30	22.82	113.67
Haicheng	19	40.85	122.75
Zoucheng	25	35.4	116.97
Wanxian	33	30.82	108.37
Donghai	30	22.95	115.64
Baiyin	15	36.55	104.17
Laizhou	25	37.18	119.94
Zaoyang	12	32.13	112.75
Quanzhou	07	24.91	118.59
Baishan	05	41.94	126.42
Zaozhuang	25	34.86	117.55
Anda	08	46.4	125.31
Shangqiu	09	34.45	115.65
Xianning	12	29.84	114.32
Korla	13	41.76	86.15
Qianjiang	12	30.42	112.89
Chenzhou	11	25.8	113.03
Jingzhou	12	30.35	112.19
Zhenzhou	04	32.28	119.17
Xindi	12	29.82	113.47
Jiutai	05	44.15	125.83
Bozhou	01	33.88	115.77
Licheng	30	23.3	113.82
Weinan	26	34.5	109.51
Nanping	07	26.65	118.17
Dongling	19	41.81	123.58
Fuyang	01	32.9	115.82
Laiyang	25	36.98	120.71
Jingmen	12	31.03	112.2
Fuling	33	29.71	107.4
Gaozhou	30	21.94	110.85
Ulanhot	20	46.08	122.08
Shanwei	30	22.78	115.35
Jiaozhou	25	36.28	120
Tongzhou	22	39.9	116.66
Anbu	30	23.45	116.68
Xiaogan	12	30.93	113.92
Qapqal	13	43.8	81.09
Zhicheng	12	30.3	111.5
Huzhou	02	30.87	120.09
Nanpiao	19	41.1	120.75
Yichun	08	47.72	128.88
Lianghu	02	29.99	120.9
Beipiao	19	41.79	120.78
Guangshui	12	31.62	114
Leshan	32	29.56	103.76
Zhaodong	08	46.07	125.98
Xinzhou	24	38.41	112.73
Sanshui	30	23.15	112.89
Boshan	25	36.48	117.83
Yangchun	30	22.17	111.78
Linhai	02	28.86	121.14
Dingzhou	10	38.51	115
Weihai	25	37.51	122.11
Chenghua	30	23.46	116.77
Deyang	32	31.13	104.38
Yichun	03	27.83	114.4
Longfeng	08	46.53	125.1
Qingyuan	30	23.7	113.03
Gaomi	25	36.38	119.75
Loudi	11	27.73	111.99
Huangyan	02	28.65	121.27
Dunhua	05	43.37	128.24
Yulin	16	22.63	110.15
Chizhou	01	30.66	117.48
Sujiatun	19	41.66	123.34
Honggang	08	46.4	124.88
Qujing	29	25.48	103.78
Hanzhong	26	33.08	107.02
Xinji	10	37.9	115.2
Taishan	30	22.25	112.78
Sanya	31	18.24	109.51
Acheng	08	45.55	126.98
Jinchang	15	38.5	102.19
Meizhou	30	24.29	116.12
Jinhua	02	29.11	119.64
Jieshou	01	33.26	115.36
Gongzhuling	05	43.5	124.82
Shanhaiguan	10	40	119.75
Altay	13	47.85	88.13
Huadian	05	42.96	126.75
Fuyu	05	45.18	124.82
Chaohu	01	31.6	117.87
Jieshi	30	22.81	115.83
Jiashan	02	30.85	120.93
Hami	13	42.83	93.51
Shizuishan	21	39.23	106.77
Gejiu	29	23.36	103.15
Jiagedaqi	20	50.42	124.12
Shiqiao	30	22.95	113.36
Dali	29	25.58	100.21
Puqi	12	29.72	113.88
Ankang	26	32.68	109.02
Zhalantun	20	48.01	122.74
Dawukou	21	39.04	106.4
Majie	29	25.03	102.64
Hepo	30	23.43	115.83
Dazhou	32	31.22	107.5
Shuangcheng	08	45.35	126.28
Dongyang	02	29.27	120.23
Jiazi	30	22.88	116.07
Songjiang	23	31.04	121.21
Shangri-La	29	27.83	99.71
Wuda	20	39.5	106.71
Leiyang	11	26.4	112.86
Xuanzhou	01	30.95	118.76
Huaihua	11	27.56	110
Jiangyou	32	31.77	104.72
Xichang	32	27.9	102.26
Danshui	30	22.8	114.47
Macheng	12	31.18	115.02
Huicheng	30	23.04	116.29
Xiazhen	25	34.8	117.11
Haimen	30	23.19	116.61
Shahecheng	10	36.94	114.51
Suining	32	30.51	105.57
Yushu	05	44.8	126.53
Lecheng	30	25.13	113.35
Laiwu	25	36.19	117.66
Jiupu	19	41.07	122.95
Baoshan	08	46.56	131.42
Luoyang	30	23.16	114.27
Minzhu	05	43.72	127.33
Huangzhou	12	30.45	114.8
Xiulin	12	29.72	112.4
Zhoucun	25	36.82	117.82
Jiayuguan	15	39.81	98.29
Lianhe	08	47.13	129.27
Xilin Hot	20	43.97	116.03
Fengcheng	19	40.45	124.07
Zhaoyuan	25	37.36	120.41
Lhasa	14	29.65	91.1
Puning	30	23.31	116.17
Shunyi	22	40.12	116.65
Longjing	05	42.77	129.42
Qingzhou	25	36.7	118.48
Dasha	30	23.11	113.44
Yakeshi	20	49.28	120.73
Binzhou	25	37.37	118.02
Lengshuijiang	11	27.69	111.43
Tianfu	25	37.26	122.05
Wenchang	31	19.62	110.75
Mingshui	25	36.72	117.5
Yuyao	02	30.05	121.15
Hotan	13	37.11	79.94
Pingshan	30	22.99	114.71
Songyuan	05	45.13	124.83
Maba	30	24.68	113.6
Guangming	05	45.33	122.78
Haikou	29	24.78	102.58
Shaowu	07	27.34	117.48
Kaiyuan	19	42.53	124.04
Beibei	33	29.83	106.44
Dongtai	04	32.85	120.31
Encheng	30	22.19	112.3
Zhuji	02	29.72	120.24
Qingnian	25	36.84	115.71
Mizhou	25	35.99	119.4
Linshui	10	36.42	114.2
Hailun	08	47.46	126.95
Shilong	30	23.11	113.85
Tieli	08	46.98	128.04
Dongxing	08	45.36	130.79
Heihe	08	50.24	127.49
Zhaotong	29	27.32	103.72
Hulan	08	45.98	126.6
Zhongxiang	12	31.17	112.58
Dehui	05	44.53	125.7
Nehe	08	48.48	124.83
Pingliang	15	35.54	106.69
Jiangyin	04	31.91	120.26
Jalai Nur	20	49.45	117.7
Shaping	30	22.77	112.96
Lianran	29	24.92	102.48
Longjiang	08	47.33	123.18
Buhe	12	30.29	112.23
Xinghua	04	32.94	119.83
Anqiu	25	36.43	119.19
Chengtangcun	25	35.08	117.19
Daxing	22	39.74	116.33
Pulandian	19	39.4	121.97
Wuchuan	30	21.46	110.77
Jishu	05	44.32	126.8
Yuxi	29	24.36	102.54
Qianzhou	11	28.32	109.73
Qinzhou	16	21.97	108.63
Lianjiang	30	21.65	110.28
Linxi	10	39.71	118.45
Zhangye	15	38.93	100.45
Kangding	32	30	101.96
Dongsheng	20	39.82	109.98
Meihekou	05	42.53	125.68
Xingcheng	19	40.62	120.72
Lishui	02	28.46	119.91
Renqiu	10	38.7	116.09
Xinshi	12	31.05	113.14
Xinyi	30	22.37	110.95
Chengzihe	08	45.33	131.07
Xishan	11	27.67	113.5
Hechuan	33	29.99	106.26
Xinyu	03	27.8	114.93
Fangshan	22	39.69	116
Lubu	30	23.17	112.28
Jinsha	04	32.09	121.07
Yicheng	04	31.36	119.82
Ducheng	30	23.24	111.53
Shenjiamen	02	29.96	122.3
Boli	08	45.75	130.57
Xiaoshan	02	30.17	120.26
Enshi	12	30.3	109.48
Wuchang	08	44.91	127.15
Yongchuan	33	29.35	105.89
Ximeicun	07	24.99	118.39
Yishui	25	35.78	118.63
Heyuan	30	23.73	114.68
Baijiantan	13	45.69	85.14
Zhengjiatun	05	43.51	123.51
Dalai	05	45.5	124.3
Changping	22	40.22	116.23
Lianzhou	30	24.78	112.37
Dongcun	25	36.78	121.16
Danjiangkou	12	32.54	111.51
Zhongshu	29	24.52	103.77
Huazhou	30	21.63	110.58
Longquan	29	24.67	102.16
Yatou	25	37.16	122.44
Lingyuan	19	41.24	119.4
Duyun	18	26.27	107.52
Pingdu	25	36.78	119.95
Gaoyou	04	32.79	119.44
Yulinshi	26	38.29	109.74
Hanting	25	36.77	119.21
Baise City	16	23.9	106.61
Tongren	18	27.72	109.19
Xihe	12	31.69	113.47
Duobao	12	30.67	112.69
Sishui	25	35.65	117.28
Gantang	11	27.44	111.97
Huaidian	09	33.43	115.03
Yiwu	02	29.32	120.08
Jinjiang	07	24.82	118.57
Fujin	08	47.26	132.03
Huaicheng	30	23.92	112.18
Lucheng	01	31.23	117.28
Hede	04	33.77	120.26
Lengshuitan	11	26.41	111.6
Wangqing	05	43.32	129.76
Yingchuan	09	34.16	113.46
Hanchuan	12	30.65	113.77
Qiongshan	31	20.01	110.35
Xiangxiang	11	27.73	112.53
Deqing	02	30.54	119.96
Yanjiang	32	30.12	104.65
Mishan	08	45.55	131.88
Nenjiang	08	49.17	125.22
Shizilu	25	35.17	118.83
Zhaogezhuang	10	39.77	118.41
Qamdo	14	31.13	97.18
Nanfeng	30	23.73	111.8
Zhangjiajie	11	29.13	110.48
Helong	05	42.54	129
Hailin	08	44.57	129.39
Nanding	25	36.75	118.06
Guozhen	26	34.37	107.36
Dengzhou	25	37.81	120.76
Qufu	25	35.6	116.99
Laojunmiao	15	39.83	97.73
Zhoushan	02	29.99	122.2
Dazhong	04	33.2	120.46
Jinxiang	02	27.43	120.61
Xiannü	04	32.43	119.56
Lingdong	08	46.57	131.15
Nanzhang Chengguanzhen	12	31.78	111.83
Xucheng	30	20.33	110.17
Hecun	10	36.53	114.11
Ningyang	25	35.76	116.79
Jinshi	11	29.6	111.87
Yuanping	24	38.72	112.76
Pizhou	04	34.31	117.95
Changqing	25	36.56	116.73
Xindian	25	36.8	118.29
Shache	13	38.42	77.24
Yima	09	34.74	111.88
Shangzhi	08	45.21	127.97
Nangong	10	37.36	115.37
Lüshun	19	38.8	121.27
Quzhou	02	28.96	118.87
Shiwan	30	23	113.08
Tangping	30	22.03	111.94
Yudong	33	29.39	106.52
Feicheng	25	35.26	117.97
Shanting	25	35.08	117.46
Zhuanghe	19	39.7	122.99
Loushanguan	18	28.14	106.82
Baoying	04	33.23	119.31
Dashiqiao	19	40.64	122.5
Panshi	05	42.94	126.06
Rikaze	14	29.25	88.88
Taixing	04	32.17	120.01
Tangjiazhuang	10	39.74	118.45
Shouguang	25	36.88	118.74
Yanta	25	36.24	115.67
Zhuangyuan	25	37.31	120.83
Wuyang	01	31.99	116.25
Xiongzhou	30	25.12	114.3
Xinzhou	12	30.87	114.8
Shitanjing	21	39.23	106.34
Tumen	05	42.97	129.84
Youhao	08	47.85	128.84
Pingyi	25	35.5	117.63
Linping	02	30.42	120.3
Linkou	08	45.29	130.26
Bijie	18	27.3	105.29
Huangmei	12	30.19	116.02
Songling	04	31.19	120.72
Jishui	09	33.73	115.4
Linqu	25	36.52	118.54
Shulan	05	44.42	126.95
Yanzhou	25	35.55	116.83
Jiexiu	24	37.02	111.91
Hunchun	05	42.87	130.36
Huangshan	01	29.71	118.31
Liangxiang	22	39.74	116.13
Fenghua	02	29.66	121.41
Guigang	16	23.1	109.61
Yangliuqing	28	39.14	117
Qingquan	12	30.45	115.26
Lintong	26	34.38	109.21
Laixi	25	36.86	120.53
Yinzhu	25	35.88	119.98
Chaoyang	05	42.66	126.03
Shangmei	11	27.74	111.3
Fuyu	08	47.8	124.46
Huilong	04	31.81	121.66
Beidao	15	34.57	105.89
Yanggu	25	36.11	115.78
Shancheng	25	34.8	116.08
Nanma	25	36.18	118.15
Suixi	01	33.89	116.77
Xinmin	19	41.99	122.83
Gucheng Chengguanzhen	12	32.27	111.63
Xianshuigu	28	38.99	117.38
Yunyang	09	33.45	112.71
Guixi	03	28.29	117.21
Lanxi	02	29.22	119.47
Genhe	20	50.78	121.52
Luocheng	32	29.38	104.03
Juegang	04	32.32	121.19
Shixing	30	24.95	114.07
Dongdu	25	35.85	117.7
Dongkan	04	34	119.83
Jiuquan	15	39.74	98.52
Dingcheng	09	32.13	115.04
Lichuan	12	30.3	108.85
Lanxi	08	46.26	126.28
Miyang	29	24.4	103.44
Beichengqu	20	40.44	113.15
Xinzhi	24	36.5	111.7
Licheng	04	31.43	119.48
Zhoucheng	25	35.91	116.31
Caidian	12	30.58	114.03
Xiuyan	19	40.29	123.27
Lianzhou	16	21.67	109.2
Changtu	19	42.78	124.1
Anlu	12	31.26	113.68
Yilan	08	46.32	129.55
Guiping	16	23.39	110.07
Fu’an	07	27.06	119.65
Kuandian	19	40.73	124.78
Poyang	03	28.99	116.67
Yongfeng	11	27.45	112.17
Gongchangling	19	41.12	123.45
Jimo	25	36.39	120.46
Baiquan	08	47.61	126.08
Jiangyan	04	32.51	120.14
Shiguai	20	40.71	110.29
Fuyang	02	30.05	119.95
Haining	02	30.54	120.69
Mengcheng Chengguanzhen	01	33.27	116.57
Wangkui	08	46.83	126.48
Jiehu	25	35.54	118.46
Linjiang	05	41.81	126.91
Tantou	07	26.03	119.6
Xiaoshi	19	41.3	124.12
Jinjiang	31	19.73	110.01
Heishan	19	41.69	122.11
Binhe	09	32.69	112.83
Pengcheng	10	36.43	114.17
Shima	07	24.45	117.81
Mingguang	01	32.78	117.96
Ninghai	02	29.29	121.42
Kuqa	13	41.72	82.93
Chaihe	08	44.76	129.68
Minggang	09	32.46	114.05
Tangzhai	01	34.43	116.59
Dongfeng	05	42.64	125.51
Zhenlai	05	45.85	123.3
Songjianghe	05	42.19	127.48
Luorong	16	24.41	109.61
Wenling	02	28.38	121.38
Fuqing	07	25.73	119.37
Caohe	12	30.23	115.43
Pingzhuang	20	42.04	119.29
Fengkou	12	30.08	113.33
Liuhe	05	42.24	125.72
Wacheng	09	33.78	114.52
Tailai	08	46.39	123.41
Chengyang	25	35.58	118.83
Sanchazi	05	42.08	126.6
Lianyuan	11	27.69	111.66
Wuxi	11	26.58	111.86
Huinan	05	42.62	126.26
Luoyang	07	24.96	118.68
Bamiantong	08	44.92	130.52
Huanren	19	41.26	125.37
Qionghu	11	28.84	112.37
Huanan	08	46.22	130.53
Zhangjiagang	04	31.87	120.54
Xiaolingwei	04	32.03	118.85
Beidaihehaibin	10	39.82	119.52
Mengyin	25	35.71	117.93
Xiangcheng Chengguanzhen	09	33.85	113.48
Dashitou	05	43.31	128.51
Qingyang	25	37.5	121.26
Babu	16	24.42	111.52
Yebaishou	19	41.4	119.64
Huaiyuan Chengguanzhen	01	32.96	117.17
Xincheng	09	33.63	115.18
Bianzhuang	25	34.85	118.04
Hepingjie	05	42.06	126.92
Ningde	07	26.66	119.52
Fengrun	10	39.83	118.12
Kunyang	02	27.67	120.57
Wanning	31	18.8	110.38
Lincheng	31	19.91	109.69
Salaqi	20	40.54	110.51
Xunchang	32	28.45	104.71
Changli	10	39.7	119.15
Kaihua	29	23.37	104.28
Yunmeng Chengguanzhen	12	31.06	113.77
Qinggang	08	46.68	126.11
Yangcun	28	39.36	117.06
Zhicheng	02	31.01	119.91
Baihe	16	22.13	107.23
Mabai	29	23.01	104.45
Nanlong	32	31.35	106.06
Xiazhuang	25	34.92	118.64
Fuding	07	27.33	120.21
Botou	10	38.07	116.57
Baoqing	08	46.33	132.21
Kaitong	05	44.81	123.08
Pingnan	16	23.54	110.39
Dêqên	14	29.96	90.72
Songyang	09	34.46	113.03
Zhaozhou	08	45.68	125.32
Yucheng	25	34.93	116.47
Shuangyang	05	43.52	125.67
Nianzishan	08	47.52	122.88
Jinghong	29	21.99	100.73
Pingyin	25	36.28	116.45
Binzhou	08	45.75	127.48
Qingshuping	11	27.38	112.02
Zhaobaoshan	02	29.97	121.69
Hushitai	19	41.94	123.5
Huoqiu Chengguanzhen	01	32.35	116.29
Mudu	04	31.26	120.52
Nandu	16	22.85	110.82
Daye	12	30.08	114.95
Yingshang Chengguanzhen	01	32.63	116.27
Pumiao	16	22.76	108.48
Hancheng	09	32.52	112.35
Lishu	05	43.3	124.33
Oroqen Zizhiqi	20	50.57	123.72
Xianju	02	28.85	120.73
Jianguang	03	28.19	115.78
Dongning	08	44.06	131.12
Suicheng	04	33.9	117.93
Tianchang	10	38	114.02
Jijiang	33	29.29	106.25
Xifeng	19	42.74	124.72
Datong	01	32.62	117.06
Yicheng	12	31.7	112.26
Yanliang	26	34.66	109.23
Tahe	08	52.33	124.73
Erdaojiang	05	41.78	126.03
Tianpeng	32	30.99	103.94
Xixiang	09	35.16	112.87
Mujiayingzi	20	42.12	118.78
Langzhong	32	31.55	105.99
Longgang	25	37.65	120.33
Gushu	01	31.56	118.48
Wucheng	01	29.6	118.17
Yuxia	26	34.06	108.63
Runing	09	33	114.35
Zhijiang	12	30.42	111.75
Taozhuang	25	34.85	117.33
Zhujiajiao	23	31.11	121.06
Wuzhen	02	30.75	120.49
Jiangkou	07	25.49	119.2
Laibin	16	23.7	109.27
Pucheng	07	27.92	118.53
Wenshang	25	35.73	116.5
Zhaoyuan	08	45.5	125.13
Mingshui	08	47.18	125.9
Huazhou	09	32.68	112.08
Gannan	08	47.91	123.5
Hongjiang	11	27.11	110
Jian’ou	07	27.04	118.32
Fuli	08	46.72	131.14
Haizhou	04	34.58	119.13
Yigou	09	35.81	114.32
Langtoucun	19	40.04	124.34
Xiaoweizhai	18	26.19	107.51
Mingyue	05	43.11	128.92
Suozhen	25	36.95	118.1
Jidong	08	45.22	131.08
Fenyi	03	27.81	114.67
Chonglong	32	29.78	104.85
Xinglongshan	05	43.96	125.47
Tongchuan	32	31.09	105.09
Hongqiao	11	26.77	112.11
Dingtao	25	35.07	115.57
Juye	25	35.39	116.09
Hancheng	26	35.46	110.43
Santangpu	11	27.41	111.99
Anxiang	11	29.4	112.15
Huangpi	12	30.88	114.38
Shanhecun	08	45.71	128.58
Yantongshan	05	43.29	126.01
Guiren	04	33.67	118.19
Zhongxing	04	33.7	118.68
Langxiang	08	46.95	128.87
Fengxian	04	34.7	116.59
Suileng	08	47.25	127.1
Wenxing	11	28.68	112.88
Baishishan	05	43.58	127.57
Ninghai	25	37.38	121.61
Jinji	16	23.23	110.83
Weining	18	26.85	104.23
Daokou	09	35.56	114.51
Yashan	16	22.2	109.94
Nantai	19	40.92	122.8
Changleng	03	28.7	115.82
Hutang	04	31.53	119.49
Gaogou	04	34.02	119.19
Linghai	19	41.17	121.37
Zijinglu	09	34.76	112.97
Qinnan	04	33.25	119.91
Dalianwan	19	39.03	121.7
Changling	05	44.27	124
Linqiong	32	30.42	103.46
Anjiang	11	27.32	110.1
Xinqing	08	48.29	129.52
Taikang	08	46.86	124.44
Yutan	11	28.26	112.56
Bayan	08	46.08	127.4
Shilin	29	24.82	103.33
Huangnihe	05	43.56	128.02
Lingcheng	16	22.71	110.35
Manzhouli	20	49.6	117.43
Liaozhong	19	41.51	122.72
Nanzhou	11	29.36	112.4
Wulingyuan	11	29.35	110.54
Songling	10	40.29	118.27
#CO
Bogotá	34	4.61	-74.08
Cali	29	3.44	-76.52
Medellín	02	6.25	-75.56
Barranquilla	04	10.97	-74.78
Cartagena	35	10.4	-75.51
Cúcuta	21	7.89	-72.51
Bucaramanga	26	7.13	-73.12
Pereira	24	4.81	-75.7
Santa Marta	38	11.24	-74.2
Ibagué	28	4.44	-75.23
Bello	02	6.34	-75.56
Pasto	20	1.21	-77.28
Manizales	37	5.07	-75.52
Neiva	16	2.93	-75.28
Soledad	04	10.92	-74.76
Villavicencio	19	4.14	-73.63
Armenia	23	4.53	-75.68
Soacha	33	4.58	-74.22
Valledupar	10	10.46	-73.25
Itagüí	02	6.18	-75.6
Montería	12	8.75	-75.88
Sincelejo	27	9.3	-75.4
Popayán	09	2.44	-76.61
Floridablanca	26	7.06	-73.09
Palmira	29	3.54	-76.3
Buenaventura	29	3.88	-77.03
Barrancabermeja	26	7.07	-73.85
Dosquebradas	24	4.84	-75.67
Tuluá	29	4.08	-76.2
Envigado	02	6.18	-75.59
Cartago	29	4.75	-75.91
Maicao	17	11.38	-72.24
Florencia	08	1.61	-75.61
Girardot City	33	4.3	-74.81
Sogamoso	36	5.71	-72.93
Guadalajara de Buga	29	3.9	-76.3
Tunja	36	5.54	-73.37
Girón	26	7.07	-73.17
Malambo	04	10.86	-74.77
Magangué	35	9.24	-74.75
Facatativá	33	4.81	-74.35
Riohacha	17	11.54	-72.91
Duitama	36	5.82	-73.03
Zipaquirá	33	5.02	-74
Fusagasugá	33	4.34	-74.36
Ciénaga	38	11.01	-74.25
Tumaco	20	1.79	-78.79
Apartadó	02	7.88	-76.63
Piedecuesta	26	6.99	-73.05
Montelíbano	12	7.98	-75.42
Ocaña	21	8.24	-73.36
La Dorada	37	5.45	-74.66
Ipiales	20	0.83	-77.64
Quibdó	11	5.69	-76.66
Aguachica	10	8.31	-73.62
Yumbo	29	3.58	-76.49
Arauca	03	7.08	-70.76
Sabanalarga	04	10.63	-74.92
Chinchiná	37	4.98	-75.6
Caldas	02	6.09	-75.64
Villa del Rosario	21	7.83	-72.47
Chía	33	4.86	-74.06
Rionegro	02	6.16	-75.37
Calarcá	23	4.53	-75.64
Yopal	32	5.34	-72.4
Sahagún	12	8.95	-75.44
Fundación	38	10.52	-74.19
Los Patios	21	7.84	-72.5
San Andrés	25	12.58	-81.71
Caucasia	02	7.99	-75.19
Santa Rosa de Cabal	24	4.87	-75.62
Espinal	28	4.15	-74.88
Turbaco	35	10.33	-75.41
Cereté	12	8.88	-75.79
El Banco	38	9	-73.98
Funza	33	4.72	-74.21
Pitalito	16	1.85	-76.05
Puerto Tejada	09	3.23	-76.42
Pamplona	21	7.38	-72.65
Agustín Codazzi	10	10.04	-73.24
Turbo	02	8.09	-76.73
Madrid	33	4.73	-74.26
Arjona	35	10.25	-75.34
#CR
San José	08	9.93	-84.08
Limón	06	9.99	-83.04
San Francisco	04	9.99	-84.13
#CU
Havana	02	23.13	-82.38
Santiago de Cuba	15	20.02	-75.83
Camagüey	05	21.38	-77.92
Holguín	12	20.89	-76.26
Guantánamo	10	20.14	-75.21
Santa Clara	16	22.41	-79.96
Diez de Octubre	02	23.09	-82.36
Arroyo Naranjo	02	23.04	-82.38
Las Tunas	13	20.96	-76.95
Bayamo	09	20.37	-76.64
Boyeros	02	23.01	-82.4
Pinar del Río	01	22.42	-83.7
Cienfuegos	08	22.15	-80.45
Ciudad Camilo Cienfuegos	02	23.16	-82.33
San Miguel del Padrón	02	23.1	-82.33
Centro Habana	02	23.14	-82.36
Matanzas	03	23.04	-81.58
Ciego de Ávila	07	21.84	-78.76
Cerro	02	23.11	-82.39
Manzanillo	09	20.34	-77.12
Sancti Spíritus	14	21.93	-79.44
Guanabacoa	02	23.13	-82.3
Palma Soriano	15	20.21	-75.99
Alamar	02	23.16	-82.28
Cárdenas	03	23.04	-81.21
La Habana Vieja	02	23.13	-82.35
Moa	12	20.66	-74.95
Puerto Padre	13	21.2	-76.6
Contramaestre	15	20.3	-76.25
Güira de Melena	AR	22.8	-82.51
Consolación del Sur	01	22.5	-83.51
Güines	MA	22.84	-82.03
Artemisa	AR	22.82	-82.76
San Luis	15	20.19	-75.85
Morón	07	22.11	-78.63
Colón	03	22.72	-80.9
Florida	05	21.53	-78.23
Sagua la Grande	16	22.81	-80.08
Trinidad	14	21.8	-79.98
San Cristobal	AR	22.72	-83.06
Placetas	16	22.31	-79.65
San José de las Lajas	MA	22.96	-82.15
Jagüey Grande	03	22.53	-81.13
Nuevitas	05	21.55	-77.27
Banes	12	20.96	-75.72
Bartolomé Masó	09	20.17	-76.94
Corralillo	16	22.98	-80.59
Jesús Menéndez	13	21.16	-76.48
#CV
Praia	14	14.93	-23.51
Mindelo	11	16.89	-24.98
#CW
Willemstad		12.11	-68.93
#CY
Nicosia	04	35.18	33.36
Limassol	05	34.68	33.04
Larnaca	03	34.92	33.62
Stróvolos	04	35.15	33.33
#CZ
Prague	52	50.09	14.42
Brno	78	49.2	16.61
Ostrava	85	49.83	18.28
Pilsen	87	49.75	13.38
Olomouc	84	49.6	17.25
Liberec	83	50.77	15.06
České Budějovice	79	48.97	14.47
Hradec Králové	82	50.21	15.83
Ústí nad Labem	89	50.66	14.03
Pardubice	86	50.04	15.78
Havířov	85	49.78	18.44
Zlín	90	49.23	17.67
Kladno	88	50.15	14.1
Most	89	50.5	13.64
Karviná	85	49.85	18.54
Opava	85	49.94	17.9
Frýdek-Místek	85	49.68	18.35
Děčín	89	50.78	14.21
Karlovy Vary	81	50.23	12.87
Teplice	89	50.64	13.82
Chomutov	89	50.46	13.42
Jihlava	80	49.4	15.59
#DE
Berlin	16	52.52	13.41
Hamburg	04	53.55	9.99
Munich	02	48.14	11.58
Köln	07	50.93	6.95
Frankfurt am Main	05	50.12	8.68
Essen	07	51.46	7.01
Stuttgart	01	48.78	9.18
Dortmund	07	51.51	7.47
Düsseldorf	07	51.22	6.78
Bremen	03	53.08	8.81
Hannover	06	52.37	9.73
Leipzig	13	51.34	12.37
Duisburg	07	51.43	6.77
Nürnberg	02	49.45	11.08
Dresden	13	51.05	13.74
Wandsbek	04	53.58	10.08
Bochum	07	51.48	7.22
Bochum-Hordel	07	51.5	7.18
Wuppertal	07	51.26	7.15
Bielefeld	07	52.03	8.53
Bonn	07	50.73	7.1
Mannheim	01	49.49	8.47
Marienthal	04	53.57	10.08
Karlsruhe	01	49.01	8.4
Hamburg-Nord	04	53.59	9.98
Wiesbaden	05	50.08	8.25
Münster	07	51.96	7.63
Gelsenkirchen	07	51.51	7.1
Aachen	07	50.78	6.08
Mönchengladbach	07	51.19	6.44
Augsburg	02	48.37	10.9
Eimsbüttel	04	53.57	9.96
Altona	04	53.55	9.93
Chemnitz	13	50.84	12.93
Braunschweig	06	52.27	10.53
Krefeld	07	51.34	6.55
Halle (Saale)	14	51.48	11.98
Hamburg-Mitte	04	53.55	10.02
Kiel	10	54.32	10.13
Magdeburg	14	52.13	11.63
Neue Neustadt	14	52.15	11.63
Oberhausen	07	51.48	6.86
Freiburg	01	48	7.85
Lübeck	10	53.87	10.69
Erfurt	15	50.98	11.03
Harburg	04	53.46	9.98
Hagen	07	51.36	7.47
Rostock	12	54.09	12.14
Kassel	05	51.32	9.5
Hamm	07	51.68	7.82
Mainz	08	49.98	8.28
Saarbrücken	09	49.23	7.01
Herne	07	51.54	7.23
Mülheim	07	51.43	6.88
Neukölln	16	52.48	13.43
Osnabrück	06	52.27	8.05
Solingen	07	51.17	7.08
Ludwigshafen am Rhein	08	49.48	8.45
Leverkusen	07	51.03	6.98
Oldenburg	06	53.14	8.21
Neuss	07	51.2	6.69
Prenzlauer Berg	16	52.54	13.42
Kreuzberg	16	52.5	13.4
Potsdam	11	52.4	13.07
Heidelberg	01	49.41	8.69
Paderborn	07	51.72	8.75
Darmstadt	05	49.87	8.65
Würzburg	02	49.79	9.95
Regensburg	02	49.02	12.1
Wolfsburg	06	52.42	10.78
Recklinghausen	07	51.61	7.2
Göttingen	06	51.53	9.93
Heilbronn	01	49.14	9.22
Ingolstadt	02	48.77	11.42
Ulm	01	48.4	9.99
Bottrop	07	51.52	6.93
Charlottenburg	16	52.52	13.28
Bergedorf	04	53.48	10.23
Pforzheim	01	48.88	8.7
Offenbach	05	50.1	8.77
Friedrichshain	16	52.52	13.45
Bremerhaven	03	53.54	8.59
Remscheid	07	51.18	7.19
Schöneberg	16	52.47	13.35
Nippes	07	50.97	6.95
Reutlingen	01	48.49	9.2
Fürth	02	49.48	10.99
Moers	07	51.45	6.63
Koblenz	08	50.35	7.58
Siegen	07	50.87	8.02
Bergisch Gladbach	07	50.99	7.13
Jena	15	50.93	11.59
Gera	15	50.88	12.08
Marzahn	16	52.55	13.57
Hildesheim	06	52.15	9.95
Erlangen	02	49.59	11.01
Witten	07	51.44	7.35
Salzgitter	06	52.16	10.42
Trier	08	49.76	6.64
Zwickau	13	50.73	12.49
Kaiserslautern	08	49.44	7.77
Iserlohn	07	51.38	7.7
Schwerin	12	53.63	11.41
Gütersloh	07	51.91	8.38
Wilmersdorf	16	52.48	13.32
Düren	07	50.8	6.49
Esslingen	01	48.74	9.3
Ratingen	07	51.3	6.85
Marl	07	51.66	7.09
Lünen	07	51.62	7.53
Hanau am Main	05	50.13	8.91
Velbert	07	51.34	7.04
Ludwigsburg	01	48.9	9.19
Flensburg	10	54.78	9.44
Gesundbrunnen	16	52.55	13.39
Cottbus	11	51.76	14.33
Wilhelmshaven	06	53.53	8.11
Tübingen	01	48.52	9.05
Minden	07	52.29	8.91
Villingen-Schwenningen	01	48.06	8.49
Konstanz	01	47.66	9.18
Mitte	16	52.52	13.4
Worms	08	49.63	8.36
Lichterfelde	16	52.43	13.31
Dorsten	07	51.66	6.97
Lüdenscheid	07	51.22	7.63
Marburg an der Lahn	05	50.81	8.77
Neumünster	10	54.07	9.98
Wedding	16	52.55	13.36
Castrop-Rauxel	07	51.56	7.31
Bogenhausen	02	48.15	11.62
Dessau	14	51.84	12.25
Gladbeck	07	51.57	6.99
Arnsberg	07	51.38	8.08
Rheine	07	52.29	7.44
Viersen	07	51.25	6.39
Delmenhorst	06	53.05	8.63
Reinickendorf	16	52.57	13.33
Bayreuth	02	49.95	11.58
Hellersdorf	16	52.53	13.61
Troisdorf	07	50.81	7.15
Gießen	05	50.59	8.68
Bocholt	07	51.84	6.62
Detmold	07	51.94	8.87
Steglitz	16	52.46	13.33
Norderstedt	10	53.69	9.98
Lüneburg	06	53.25	10.41
Celle	06	52.62	10.08
Moabit	16	52.53	13.34
Dinslaken	07	51.56	6.74
Bamberg	02	49.9	10.9
Aschaffenburg	02	49.98	9.15
Neubrandenburg	12	53.56	13.28
Lippstadt	07	51.67	8.34
Aalen	01	48.84	10.09
Neuwied	08	50.43	7.47
Unna	07	51.54	7.69
Plauen	13	50.5	12.14
Herten	07	51.6	7.14
Herford	07	52.11	8.67
Grevenbroich	07	51.09	6.58
Weimar	15	50.98	11.33
Kerpen	07	50.87	6.7
Fulda	05	50.55	9.68
Dormagen	07	51.1	6.83
Bergheim	07	50.96	6.64
Garbsen	06	52.41	9.59
Wesel	07	51.67	6.62
Kempten (Allgäu)	02	47.73	10.31
Schwäbisch Gmünd	01	48.8	9.8
Sindelfingen	01	48.7	9.02
Landshut	02	48.53	12.16
Rosenheim	02	47.86	12.12
Köpenick	16	52.45	13.57
Brandenburg an der Havel	11	52.42	12.55
Rüsselsheim	05	49.99	8.42
Berlin Köpenick	16	52.44	13.58
Langenfeld	07	51.11	6.95
Offenburg	01	48.47	7.94
Stralsund	12	54.31	13.08
Stolberg	07	50.77	6.23
Hameln	06	52.1	9.36
Zehlendorf	16	52.43	13.25
Menden	07	51.44	7.78
Friedrichshafen	01	47.66	9.48
Göppingen	01	48.7	9.65
Görlitz	13	51.16	14.99
Pankow	16	52.57	13.4
Hattingen	07	51.4	7.19
Tempelhof	16	52.47	13.4
Hilden	07	51.17	6.93
Sankt Augustin	07	50.78	7.2
Eschweiler	07	50.82	6.27
Ahlen	07	51.76	7.89
Bad Salzuflen	07	52.09	8.74
Euskirchen	07	50.66	6.79
Meerbusch	07	51.25	6.69
Wolfenbüttel	06	52.16	10.54
Hürth	07	50.87	6.87
Baden-Baden	01	48.76	8.24
Schweinfurt	02	50.05	10.22
Neustadt	08	49.35	8.14
Pulheim	07	51	6.81
Neu-Hohenschönhausen	16	52.57	13.51
Gummersbach	07	51.03	7.56
Waiblingen	01	48.83	9.32
Nordhorn	06	52.43	7.07
Greifswald	12	54.09	13.39
Cuxhaven	06	53.87	8.7
Wetzlar	05	50.56	8.5
Bergkamen	07	51.62	7.64
Bad Homburg vor der Höhe	05	50.23	8.62
Willich	07	51.26	6.55
Frankfurt (Oder)	11	52.35	14.55
Emden	06	53.37	7.21
Neu-Ulm	02	48.39	10.01
Lingen	06	52.52	7.32
Winterhude	04	53.6	10
Erftstadt	07	50.81	6.79
Neubrück	07	51.13	6.64
Ibbenbüren	07	52.28	7.71
Passau	02	48.57	13.43
Langenhagen	06	52.45	9.74
Schwerte	07	51.44	7.57
Speyer	08	49.32	8.43
Heidenheim an der Brenz	01	48.68	10.15
Berlin Treptow	16	52.49	13.44
#DJ
Djibouti	07	11.59	43.15
'Ali Sabieh	01	11.16	42.71
#DK
Copenhagen	17	55.68	12.57
Århus	18	56.16	10.21
Odense	21	55.4	10.39
Aalborg	19	57.05	9.92
Frederiksberg	17	55.68	12.53
Esbjerg	21	55.47	8.45
Horsens	18	55.86	9.85
Randers	18	56.46	10.04
Kolding	21	55.49	9.47
Vejle	21	55.71	9.54
#DO
Santo Domingo	34	18.47	-69.89
Santiago de los Caballeros	25	19.45	-70.7
Santo Domingo Oeste	37	18.5	-70
Santo Domingo Este	37	18.49	-69.86
San Pedro de Macorís	24	18.45	-69.31
La Romana	12	18.43	-68.97
Bella Vista	34	18.46	-69.95
San Cristóbal	33	18.42	-70.1
Puerto Plata	18	19.79	-70.69
San Francisco de Macorís	06	19.3	-70.25
Salvaleón de Higüey	10	18.62	-68.71
Concepción de La Vega	30	19.22	-70.53
Punta Cana	10	18.58	-68.4
Santa Cruz de Barahona	03	18.21	-71.1
Bonao	31	18.94	-70.41
San Juan de la Maguana	23	18.81	-71.23
Bajos de Haina	33	18.42	-70.03
Baní	35	18.28	-70.33
Moca	08	19.39	-70.53
Azua	01	18.45	-70.73
Villa Francisca	34	18.48	-69.89
#DZ
Algiers	01	36.73	3.09
Boumerdas	40	36.77	3.48
Oran	09	35.7	-0.64
Tébessa	33	35.4	8.12
Constantine	04	36.37	6.61
Biskra	19	34.85	5.73
Sétif	12	36.19	5.41
Batna	03	35.56	6.17
Bab Ezzouar	01	36.73	3.18
Annaba	37	36.9	7.77
Sidi Bel Abbès	30	35.19	-0.63
Blida	20	36.47	2.83
Tiaret	13	35.37	1.32
Chlef	41	36.17	1.33
Bordj Bou Arreridj	39	36.07	4.76
Ech Chettia	41	36.2	1.26
Bejaïa	18	36.76	5.08
Skikda	31	36.88	6.91
El Achir	39	36.06	4.63
Souk Ahras	52	36.29	7.95
Djelfa	22	34.67	3.26
Mascara	26	35.4	0.14
Jijel	24	36.82	5.76
Médéa	06	36.26	2.75
Tizi Ouzou	14	36.71	4.05
Béchar	38	31.62	-2.22
El Oued	43	33.36	6.86
Tlemcen	15	34.88	-1.31
Relizane	51	35.74	0.56
Mostaganem	07	35.93	0.09
Ouargla	50	31.95	5.33
El Eulma	12	36.15	5.69
Saïda	10	34.83	0.15
Guelma	23	36.46	7.43
Bordj el Kiffan	01	36.75	3.19
Aïn Oussera	22	35.45	2.91
Khenchela	47	35.44	7.14
Laghouat	25	33.8	2.87
Aïn Beïda	29	35.8	7.39
Baraki	55	36.67	3.1
Oum el Bouaghi	29	35.88	7.11
M’Sila	27	35.71	4.54
Messaad	22	34.15	3.5
Barika	03	35.39	5.37
Ghardaïa	45	32.49	3.67
Beni Mered	20	36.52	2.86
Aflou	25	34.11	2.1
El Khroub	04	36.26	6.69
Rouissat	50	31.92	5.35
Berrouaghia	06	36.14	2.91
Ksar el Boukhari	06	35.89	2.75
Khemis Miliana	35	36.26	2.22
Azzaba	31	36.74	7.11
Tamanrasset	53	22.79	5.52
Aïn Touta	03	35.38	5.9
Cheria	33	35.27	7.75
Birkhadem	01	36.71	3.05
Chelghoum el Aïd	48	36.16	6.17
Sidi Aïssa	27	35.89	3.77
Larbaâ	20	36.56	3.15
Mila	48	36.45	6.26
Bir el Ater	33	34.74	8.06
Sougueur	13	35.19	1.5
Aïn Fakroun	29	35.97	6.87
Tolga	19	34.72	5.38
Es Senia	09	35.65	-0.62
Bir el Djir	09	35.72	-0.55
Akbou	18	36.46	4.53
Besbes	44	36.7	7.85
El Bayadh	42	33.68	1.02
Sidi Khaled	19	34.39	4.99
Aïn Sefra	49	32.75	-0.58
Frenda	13	35.07	1.05
Bougara	20	36.54	3.08
Hamma Bouziane	04	36.41	6.6
Reguiba	43	33.56	6.7
Tissemsilt	56	35.61	1.81
Meftah	20	36.62	3.22
Oued Rhiou	51	35.96	0.92
Boufarik	20	36.57	2.91
Sig	26	35.53	-0.19
Ksar Chellala	13	35.21	2.32
Sidi Moussa	20	36.61	3.09
Aïn Temouchent	36	35.3	-1.14
Râs el Oued	39	35.94	5.03
Lakhdaria	21	36.56	3.59
Drean	37	36.68	7.75
Reghaïa	40	36.74	3.34
Boghni	14	36.54	3.95
Dar Chioukh	22	34.9	3.49
Sedrata	52	36.13	7.53
Hassi Messaoud	50	31.68	6.07
Djamaa	50	33.53	5.99
Bouïra	21	36.37	3.9
Mansoûra	15	34.86	-1.34
Aïn Defla	35	36.26	1.97
Telerghma	48	36.12	6.35
Remchi	15	35.06	-1.43
Birine	22	35.64	3.23
Sour el Ghozlane	21	36.15	3.69
Metlili Chaamba	45	32.27	3.63
#EC
Guayaquil	10	-2.2	-79.89
Quito	18	-0.23	-78.52
Cuenca	02	-2.9	-79
Santo Domingo de los Colorados	26	-0.25	-79.18
Machala	08	-3.26	-79.96
Manta	14	-0.96	-80.71
Portoviejo	14	-1.05	-80.45
Eloy Alfaro	10	-2.18	-79.86
Esmeraldas	09	0.96	-79.65
Ambato	19	-1.25	-78.62
Tutamandahostel	18	-0.2	-78.5
Milagro	10	-2.13	-79.59
Ibarra	11	0.35	-78.12
Riobamba	06	-1.67	-78.65
Quevedo	13	-1.03	-79.46
Loja	12	-3.99	-79.2
Tulcán	05	0.81	-77.72
Babahoyo	13	-1.8	-79.53
La Libertad	10	-2.23	-80.91
Latacunga	07	-0.94	-78.62
#EE
Tallinn	01	59.44	24.75
Tartu	18	58.38	26.73
Narva	03	59.38	28.19
#EG
Cairo	11	30.06	31.25
Alexandria	06	31.2	29.92
Giza	08	30.01	31.21
Port Said	19	31.27	32.3
Suez	15	29.97	32.53
Al Maḩallah al Kubrá	05	30.97	31.17
Luxor	28	25.7	32.64
Asyūţ	17	27.18	31.18
Al Manşūrah	01	31.04	31.38
Tanda	05	30.79	31
Al Fayyūm	04	29.31	30.84
Zagazig	14	30.59	31.5
Ismailia	07	30.6	32.27
Kafr ad Dawwār	03	31.13	30.13
Aswan	16	24.09	32.9
Qinā	23	26.16	32.73
Ḩalwān	11	29.84	31.3
Damanhūr	03	31.03	30.47
Al Minyā	10	28.09	30.76
Idkū	03	31.31	30.3
Sohag	24	26.56	31.69
New Cairo	11	30.03	31.47
Banī Suwayf	18	29.07	31.1
Shibīn al Kawm	09	30.55	31.01
Banhā	12	30.46	31.18
Ţalkhā	01	31.05	31.38
Kafr ash Shaykh	21	31.11	30.94
Mallawī	10	27.73	30.84
Dikirnis	01	31.09	31.59
Idfū	16	24.98	32.88
Bilbays	14	30.42	31.56
Arish	27	31.13	33.8
Jirjā	24	26.34	31.89
Al Ḩawāmidīyah	08	29.9	31.25
Bilqās	01	31.21	31.36
Disūq	21	31.13	30.65
Abū Kabīr	14	30.73	31.67
Qalyūb	12	30.18	31.21
Akhmīm	24	26.56	31.75
Al Maţarīyah	01	31.18	32.03
Hurghada	02	27.26	33.81
Zefta	05	30.71	31.24
Ţahţā	24	26.77	31.5
Samālūţ	10	28.31	30.71
Būsh	18	29.15	31.13
Ḩawsh ‘Īsá	03	30.91	30.29
Munūf	09	30.47	30.93
Ashmūn	09	30.3	30.98
Manfalūţ	17	27.31	30.97
Damietta	20	31.42	31.81
Kafr az Zayyāt	05	30.82	30.82
Abū Tīj	17	27.05	31.32
Isnā	23	25.29	32.55
Abnūb	17	27.27	31.15
Al Qūşīyah	17	27.44	30.82
Al Jammālīyah	01	31.18	31.86
Dayrūţ	17	27.56	30.81
Al Khārijah	13	25.45	30.55
Toukh	12	30.35	31.2
Al Manzalah	01	31.16	31.94
Rosetta	03	31.4	30.42
Awsīm	08	30.12	31.14
Al Fashn	18	28.82	30.9
Fuwwah	21	31.2	30.55
Fāqūs	14	30.73	31.8
Al Khānkah	12	30.21	31.37
Mersa Matruh	22	31.35	27.24
Al Qurayn	14	30.62	31.74
Abū Qurqāş	10	27.93	30.84
Al Manshāh	24	26.48	31.8
Kousa	23	25.92	32.76
Kawm Umbū	16	24.48	32.95
Fāraskūr	20	31.33	31.72
Banī Mazār	10	28.5	30.8
Minyat an Naşr	01	31.13	31.64
Shibīn al Qanāṭir	12	30.31	31.32
Al Qanāţir al Khayrīyah	12	30.19	31.14
Basyūn	05	30.94	30.81
Samannūd	05	30.96	31.24
Shirbīn	01	31.2	31.52
Dishnā	23	26.12	32.48
Farshūţ	23	26.05	32.16
Diyarb Najm	14	30.75	31.44
At Tall al Kabīr	14	30.54	31.79
Talā	09	30.68	30.94
Ibshawāy	04	29.36	30.68
#EH
Laayoune		27.14	-13.19
Dakhla	CE	23.68	-15.96
#ER
Asmara	05	15.34	38.93
Keren	01	15.78	38.45
#ES
Madrid	29	40.42	-3.7
Barcelona	56	41.39	2.16
Valencia	60	39.47	-0.38
Sevilla	51	37.38	-5.97
Zaragoza	52	41.66	-0.88
Málaga	51	36.72	-4.42
Murcia	31	37.99	-1.13
Palma	07	39.57	2.65
Las Palmas de Gran Canaria	53	28.1	-15.41
Bilbao	59	43.26	-2.93
Alicante	60	38.35	-0.48
Córdoba	51	37.89	-4.77
Valladolid	55	41.66	-4.72
Vigo	58	42.23	-8.72
Gijón	34	43.54	-5.66
Eixample	56	41.39	2.16
L'Hospitalet de Llobregat	56	41.36	2.1
Latina	29	40.39	-3.75
Carabanchel	29	40.39	-3.72
A Coruña	58	43.37	-8.4
Puente de Vallecas	29	40.39	-3.66
Sant Martí	56	41.42	2.2
Gasteiz / Vitoria	59	42.85	-2.67
Granada	51	37.19	-3.61
Elche	60	38.26	-0.7
Ciudad Lineal	29	40.45	-3.65
Oviedo	34	43.36	-5.84
Santa Cruz de Tenerife	53	28.47	-16.25
Fuencarral-El Pardo	29	40.5	-3.73
Badalona	56	41.45	2.25
Cartagena	31	37.61	-0.99
Terrassa	56	41.57	2.02
Jerez de la Frontera	51	36.69	-6.14
Sabadell	56	41.54	2.11
Móstoles	29	40.32	-3.86
Alcalá de Henares	29	40.48	-3.36
Pamplona	32	42.82	-1.64
Fuenlabrada	29	40.28	-3.79
Almería	51	36.84	-2.46
Leganés	29	40.33	-3.76
Donostia / San Sebastián	59	43.31	-1.97
Sants-Montjuïc	56	41.37	2.15
Santander	39	43.46	-3.8
Castelló de la Plana	60	39.99	-0.05
Burgos	55	42.34	-3.7
Albacete	54	38.99	-1.86
Horta-Guinardó	56	41.42	2.17
Alcorcón	29	40.35	-3.82
Getafe	29	40.31	-3.73
Nou Barris	56	41.44	2.18
Hortaleza	29	40.47	-3.64
San Blas-Canillejas	29	40.44	-3.62
Salamanca	55	40.97	-5.66
Tetuán de las Victorias	29	40.46	-3.7
Logroño	27	42.47	-2.45
La Laguna	53	28.49	-16.32
City Center	29	40.42	-3.7
Huelva	51	37.27	-6.94
Arganzuela	29	40.4	-3.7
Badajoz	57	38.88	-6.97
Sarrià-Sant Gervasi	56	41.4	2.14
Sant Andreu	56	41.44	2.19
Salamanca	29	40.43	-3.68
Chamberí	29	40.43	-3.7
Usera	29	40.39	-3.7
Tarragona	56	41.12	1.25
Chamartín	29	40.46	-3.68
Lleida	56	41.62	0.62
Marbella	51	36.52	-4.89
León	55	42.6	-5.57
Villaverde	29	40.35	-3.7
Cadiz	51	36.53	-6.29
Retiro	29	40.41	-3.68
Dos Hermanas	51	37.28	-5.92
Mataró	56	41.54	2.44
Gràcia	56	41.4	2.16
Santa Coloma de Gramenet	56	41.45	2.21
Torrejón de Ardoz	29	40.46	-3.47
Jaén	51	37.77	-3.79
Moncloa-Aravaca	29	40.44	-3.73
Algeciras	51	36.13	-5.45
Parla	29	40.24	-3.77
Delicias	52	41.65	-0.91
Ourense	58	42.34	-7.86
Alcobendas	29	40.55	-3.64
Reus	56	41.16	1.11
Moratalaz	29	40.41	-3.65
Ciutat Vella	56	41.38	2.17
Torrevieja	60	37.98	-0.68
Telde	53	27.99	-15.42
Barakaldo	59	43.3	-2.99
Lugo	58	43.01	-7.56
San Fernando	51	36.48	-6.2
Girona	56	41.98	2.82
Santiago de Compostela	58	42.88	-8.55
Cáceres	57	39.48	-6.37
Lorca	31	37.67	-1.7
Coslada	29	40.42	-3.56
Talavera de la Reina	54	39.96	-4.83
El Puerto de Santa María	51	36.59	-6.23
Cornellà de Llobregat	56	41.35	2.08
Las Rozas de Madrid	29	40.49	-3.87
Orihuela	60	38.08	-0.94
Avilés	34	43.55	-5.92
El Ejido	51	36.78	-2.81
Guadalajara	54	40.63	-3.16
Roquetas de Mar	51	36.76	-2.61
Palencia	55	42.01	-4.52
Algorta	59	43.35	-3.01
Sant Boi de Llobregat	56	41.34	2.04
Pozuelo de Alarcón	29	40.43	-3.81
Toledo	54	39.86	-4.02
Les Corts	56	41.39	2.13
Pontevedra	58	42.43	-8.64
Getxo	59	43.36	-3.01
Gandia	60	38.97	-0.18
Sant Cugat del Vallès	56	41.47	2.09
Ceuta	CE	35.89	-5.32
Arona	53	28.1	-16.68
Torrent	60	39.44	-0.47
Chiclana de la Frontera	51	36.42	-6.14
Manresa	56	41.73	1.82
San Sebastián de los Reyes	29	40.56	-3.63
Ferrol	58	43.48	-8.23
Vélez-Málaga	51	36.78	-4.1
Ciudad Real	54	38.99	-3.93
Mijas	51	36.6	-4.64
Melilla	ML	35.29	-2.94
Rubí	56	41.49	2.03
Fuengirola	51	36.54	-4.62
Benidorm	60	38.54	-0.13
Alcalá de Guadaira	51	37.34	-5.84
Ponferrada	55	42.55	-6.6
Rivas-Vaciamadrid	29	40.33	-3.51
Majadahonda	29	40.47	-3.87
Campiña	51	38.22	-2.98
Vicálvaro	29	40.4	-3.6
Zamora	55	41.51	-5.74
Sagunto	60	39.68	-0.27
Vilanova i la Geltrú	56	41.22	1.73
Sanlúcar de Barrameda	51	36.78	-6.35
Estepona	51	36.43	-5.15
Torremolinos	51	36.62	-4.5
Villa de Vallecas	29	40.37	-3.6
La Línea de la Concepción	51	36.17	-5.35
Molina de Segura	31	38.05	-1.21
Paterna	60	39.5	-0.44
Santa Lucía	53	27.91	-15.54
Viladecans	56	41.31	2.01
El Prat de Llobregat	56	41.33	2.09
Valdemoro	29	40.19	-3.68
Grao de Murviedro	60	39.64	-0.24
Castelldefels	56	41.28	1.97
Alcoy	60	38.71	-0.47
Linares	51	38.1	-3.64
Irun	59	43.34	-1.79
Granollers	56	41.61	2.29
Motril	51	36.75	-3.52
Gamonal	55	42.36	-3.67
Santutxu	59	43.25	-2.92
Arrecife	53	28.96	-13.55
Benalmádena	51	36.6	-4.57
Cerdanyola del Vallès	56	41.49	2.14
la Nova Esquerra de l'Eixample	56	41.38	2.15
Ávila	55	40.66	-4.7
Barri de Sant Andreu	56	41.44	2.19
Segovia	55	40.95	-4.12
Mérida	57	38.92	-6.34
Cuenca	54	40.07	-2.13
Torrelavega	39	43.35	-4.05
Elda	60	38.48	-0.79
Collado-Villalba	29	40.64	-4
Aranjuez	29	40.03	-3.6
San Vicent del Raspeig	60	38.4	-0.53
Mollet del Vallès	56	41.54	2.21
San Bartolomé de Tirajana	53	27.92	-15.57
Huesca	52	42.14	-0.41
Puertollano	54	38.69	-4.11
Calvià	07	39.57	2.51
Sagrada Família	56	41.4	2.17
Arganda	29	40.3	-3.44
Vila-real	60	39.94	-0.1
la Vila de Gràcia	56	41.4	2.16
Utrera	51	37.19	-5.78
#ET
Addis Ababa	44	9.02	38.75
Dire Dawa	48	9.59	41.87
Mek'ele	53	13.5	39.48
Nazrēt	51	8.55	39.27
Bahir Dar	46	11.59	37.39
Gondar	46	12.6	37.47
Desē	46	11.13	39.63
Hawassa	54	7.06	38.48
Jimma	51	7.67	36.83
Bishoftu	51	8.75	38.98
Kombolcha	46	11.08	39.74
Harar	50	9.31	42.12
Sodo	54	6.86	37.76
Shashemenē	51	7.2	38.6
Hosa’ina	54	7.55	37.85
Arba Minch	54	6.03	37.55
Ādīgrat	53	14.28	39.46
Debre Mark’os	46	10.35	37.73
Debre Birhan	46	9.68	39.53
Jijiga	52	9.35	42.8
Inda Silasē	53	14.1	38.28
#FI
Helsinki	01	60.17	24.94
Espoo	01	60.21	24.65
Tampere	06	61.5	23.79
Vantaa	01	60.29	25.04
Turku	02	60.45	22.27
Oulu	17	65.01	25.47
Lahti	07	60.98	25.66
Kuopio	11	62.89	27.68
Jyväskylä	13	62.24	25.72
Pori	04	61.48	21.78
Lappeenranta	09	61.06	28.19
Vaasa	15	63.1	21.62
Kotka	08	60.47	26.95
Joensuu	12	62.6	29.76
#FJ
Suva	01	-18.14	178.44
Lautoka	05	-17.62	177.45
#FR
Paris	11	48.85	2.35
Marseille	93	43.3	5.38
Lyon	84	45.75	4.85
Toulouse	76	43.6	1.44
Nice	93	43.7	7.27
Nantes	52	47.22	-1.55
Strasbourg	44	48.58	7.75
Montpellier	76	43.61	3.88
Bordeaux	75	44.84	-0.58
Lille	32	50.63	3.06
Rennes	53	48.11	-1.67
Reims	44	49.27	4.03
Le Havre	28	49.49	0.11
Cergy-Pontoise	11	49.04	2.08
Saint-Étienne	84	45.43	4.39
Toulon	93	43.12	5.93
Angers	52	47.47	-0.55
Grenoble	84	45.18	5.71
Dijon	27	47.32	5.02
Nîmes	76	43.83	4.36
Aix-en-Provence	93	43.53	5.45
Saint-Quentin-en-Yvelines	11	48.77	2.02
Brest	53	48.39	-4.49
Le Mans	52	48	0.2
Amiens	32	49.9	2.3
Tours	24	47.39	0.7
Limoges	75	45.83	1.25
Clermont-Ferrand	84	45.78	3.09
Villeurbanne	84	45.77	4.88
Besançon	27	47.25	6.02
Orléans	24	47.9	1.9
Metz	44	49.12	6.17
Rouen	28	49.44	1.1
Mulhouse	44	47.75	7.33
Perpignan	76	42.7	2.9
Caen	28	49.19	-0.36
Boulogne-Billancourt	11	48.84	2.24
Nancy	44	48.68	6.18
Argenteuil	11	48.95	2.25
Saint-Denis	11	48.94	2.35
Roubaix	32	50.69	3.17
Tourcoing	32	50.72	3.16
Montreuil	11	48.86	2.44
Avignon	93	43.95	4.81
Marseille 13	93	43.32	5.41
Asnières-sur-Seine	11	48.92	2.28
Nanterre	11	48.89	2.21
Poitiers	75	46.58	0.34
Versailles	11	48.8	2.13
Courbevoie	11	48.9	2.26
Créteil	11	48.79	2.47
Pau	75	43.31	-0.36
Colombes	11	48.92	2.25
Vitry-sur-Seine	11	48.79	2.4
Aulnay-sous-Bois	11	48.94	2.49
Marseille 08	93	43.27	5.38
Marseille 15	93	43.37	5.35
Marseille 09	93	43.25	5.41
La Rochelle	75	46.16	-1.15
Champigny-sur-Marne	11	48.82	2.49
Rueil-Malmaison	11	48.88	2.19
Antibes	93	43.59	7.11
Saint-Maur-des-Fossés	11	48.79	2.49
Calais	32	50.95	1.86
Béziers	76	43.34	3.21
Dunkerque	32	51.03	2.38
Aubervilliers	11	48.92	2.38
Cannes	93	43.55	7.01
Mérignac	75	44.84	-0.65
Bourges	24	47.08	2.4
Saint-Nazaire	52	47.28	-2.21
Colmar	44	48.08	7.36
Valence	84	44.93	4.91
Quimper	53	48	-4.1
Drancy	11	48.93	2.45
Noisy-le-Grand	11	48.85	2.56
Villeneuve-d'Ascq	32	50.62	3.17
La Seyne-sur-Mer	93	43.1	5.88
Levallois-Perret	11	48.89	2.29
Marseille 14	93	43.34	5.38
Chambéry	84	45.57	5.92
Issy-les-Moulineaux	11	48.82	2.28
Neuilly-sur-Seine	11	48.88	2.27
Troyes	44	48.3	4.09
Antony	11	48.75	2.3
La Roche-sur-Yon	52	46.67	-1.43
Marseille 12	93	43.3	5.44
Lorient	53	47.75	-3.37
Sarcelles	11	49	2.38
Pessac	75	44.81	-0.63
Ivry-sur-Seine	11	48.82	2.38
Évreux	28	49.02	1.15
Vénissieux	84	45.7	4.89
Cergy	11	49.04	2.08
Clichy	11	48.9	2.31
Marseille 11	93	43.29	5.44
Saint-Quentin	32	49.85	3.29
Niort	75	46.32	-0.46
Belfort	27	47.64	6.85
Ajaccio	94	41.92	8.74
Vannes	53	47.66	-2.76
Sartrouville	11	48.95	2.19
Maisons-Alfort	11	48.81	2.44
Meaux	11	48.96	2.88
Blois	24	47.59	1.33
Brive-la-Gaillarde	75	45.16	1.53
Arles	93	43.68	4.63
Beauvais	32	49.43	2.08
Châteauroux	24	46.81	1.69
Cholet	52	47.06	-0.88
Fréjus	93	43.43	6.74
Pantin	11	48.89	2.41
Saint-Brieuc	53	48.52	-2.77
Montauban	76	44.02	1.36
Charleville-Mézières	44	49.77	4.72
Albi	76	43.93	2.15
Tarbes	76	43.23	0.08
Fontenay-sous-Bois	11	48.85	2.48
Évry	11	48.63	2.44
Clamart	11	48.8	2.27
Marseille 10	93	43.28	5.42
Châlons-en-Champagne	44	48.95	4.37
Narbonne	76	43.18	3
Saint-Malo	53	48.65	-2.01
Laval	52	48.07	-0.76
Hyères	93	43.12	6.13
#GA
Libreville	01	0.39	9.45
Port-Gentil	08	-0.72	8.78
#GB
London	ENG	51.51	-0.13
Birmingham	ENG	52.48	-1.9
Liverpool	ENG	53.41	-2.98
Nottingham	ENG	52.95	-1.15
Sheffield	ENG	53.38	-1.47
Bristol	ENG	51.46	-2.6
Glasgow	SCT	55.87	-4.26
Leicester	ENG	52.64	-1.13
Edinburgh	SCT	55.95	-3.2
Leeds	ENG	53.8	-1.55
Cardiff	WLS	51.48	-3.18
Manchester	ENG	53.48	-2.24
Stoke-on-Trent	ENG	53	-2.19
Coventry	ENG	52.41	-1.51
Sunderland	ENG	54.9	-1.38
Brent	ENG	51.55	-0.3
Birkenhead	ENG	53.39	-3.01
Islington	ENG	51.54	-0.1
Reading	ENG	51.46	-0.97
Kingston upon Hull	ENG	53.74	-0.34
Preston	ENG	53.76	-2.7
Newport	WLS	51.59	-3
Swansea	WLS	51.62	-3.94
Bradford	ENG	53.79	-1.75
Southend-on-Sea	ENG	51.54	0.71
Belfast	NIR	54.6	-5.93
Derby	ENG	52.92	-1.48
Plymouth	ENG	50.37	-4.14
Luton	ENG	51.88	-0.42
Wolverhampton	ENG	52.59	-2.12
City of Westminster	ENG	51.5	-0.14
Southampton	ENG	50.9	-1.4
Blackpool	ENG	53.82	-3.05
Milton Keynes	ENG	52.04	-0.76
Bexley	ENG	51.44	0.15
Northampton	ENG	52.25	-0.88
Archway	ENG	51.57	-0.13
Norwich	ENG	52.63	1.3
Dudley	ENG	52.5	-2.08
Aberdeen	SCT	57.14	-2.1
Portsmouth	ENG	50.8	-1.09
Newcastle upon Tyne	ENG	54.97	-1.61
Sutton	ENG	51.35	-0.2
Swindon	ENG	51.56	-1.78
Crawley	ENG	51.11	-0.18
Ipswich	ENG	52.06	1.16
Wigan	ENG	53.54	-2.64
Croydon	ENG	51.38	-0.1
Walsall	ENG	52.59	-1.98
Mansfield	ENG	53.13	-1.2
Oxford	ENG	51.75	-1.26
Warrington	ENG	53.39	-2.58
Slough	ENG	51.51	-0.6
Bournemouth	ENG	50.72	-1.88
Peterborough	ENG	52.57	-0.25
Cambridge	ENG	52.2	0.12
Doncaster	ENG	53.52	-1.13
York	ENG	53.96	-1.08
Poole	ENG	50.71	-1.98
Gloucester	ENG	51.87	-2.24
Burnley	ENG	53.8	-2.23
Huddersfield	ENG	53.65	-1.78
Telford	ENG	52.68	-2.45
Dundee	SCT	56.47	-2.97
Blackburn	ENG	53.75	-2.48
Basildon	ENG	51.57	0.46
Middlesbrough	ENG	54.58	-1.23
Bolton	ENG	53.58	-2.43
Stockport	ENG	53.41	-2.16
Brighton	ENG	50.83	-0.14
West Bromwich	ENG	52.52	-1.99
Grimsby	ENG	53.57	-0.08
Hastings	ENG	50.86	0.57
High Wycombe	ENG	51.63	-0.75
Watford	ENG	51.66	-0.4
Saint Peters	ENG	51.37	1.42
Burton upon Trent	ENG	52.81	-1.64
Colchester	ENG	51.89	0.9
Eastbourne	ENG	50.77	0.28
Exeter	ENG	50.72	-3.53
Rotherham	ENG	53.43	-1.36
Cheltenham	ENG	51.9	-2.08
Lincoln	ENG	53.23	-0.54
Chesterfield	ENG	53.25	-1.42
Chelmsford	ENG	51.74	0.47
Mendip	ENG	51.24	-2.63
Dagenham	ENG	51.55	0.17
Basingstoke	ENG	51.26	-1.09
Maidstone	ENG	51.27	0.52
Sutton Coldfield	ENG	52.57	-1.82
Bedford	ENG	52.13	-0.47
Oldham	ENG	53.54	-2.12
Enfield Town	ENG	51.65	-0.08
Woking	ENG	51.32	-0.56
St Helens	ENG	53.45	-2.73
Worcester	ENG	52.19	-2.22
Gillingham	ENG	51.39	0.55
Becontree	ENG	51.55	0.13
Worthing	ENG	50.82	-0.38
Rochdale	ENG	53.62	-2.16
Solihull	ENG	52.41	-1.78
Royal Leamington Spa	ENG	52.29	-1.52
Romford	ENG	51.58	0.19
Bath	ENG	51.38	-2.36
Harlow	ENG	51.78	0.11
Nuneaton	ENG	52.52	-1.47
High Peak	ENG	53.37	-1.85
Darlington	ENG	54.52	-1.55
Southport	ENG	53.65	-3.01
Chester	ENG	53.19	-2.89
Stevenage	ENG	51.9	-0.2
Wembley	ENG	51.55	-0.3
Grays	ENG	51.48	0.33
Harrogate	ENG	53.99	-1.54
Hartlepool	ENG	54.69	-1.21
Londonderry County Borough	NIR	55	-7.31
Cannock	ENG	52.69	-2.03
Hemel Hempstead	ENG	51.75	-0.45
St Albans	ENG	51.75	-0.33
Redditch	ENG	52.31	-1.95
South Shields	ENG	55	-1.43
Derry	NIR	55	-7.31
Weston-super-Mare	ENG	51.35	-2.98
Halifax	ENG	53.72	-1.85
Beckenham	ENG	51.41	-0.03
Tamworth	ENG	52.63	-1.7
Scunthorpe	ENG	53.58	-0.65
Stockton-on-Tees	ENG	54.57	-1.32
Wakefield	ENG	53.68	-1.5
Carlisle	ENG	54.9	-2.94
Gateshead	ENG	54.96	-1.6
Lisburn	NIR	54.52	-6.04
Fylde	ENG	53.83	-2.92
Paisley	SCT	55.83	-4.43
Bracknell	ENG	51.41	-0.75
Newcastle under Lyme	ENG	53	-2.23
Battersea	ENG	51.47	-0.16
Crewe	ENG	53.1	-2.44
Chatham	ENG	51.38	0.53
Hove	ENG	50.83	-0.17
Aylesbury	ENG	51.82	-0.81
East Kilbride	SCT	55.76	-4.18
Canary Wharf	ENG	51.51	-0.02
Rugby	ENG	52.37	-1.26
Salford	ENG	53.49	-2.29
Purley	ENG	51.34	-0.11
Guildford	ENG	51.24	-0.57
Shrewsbury	ENG	52.71	-2.75
Peckham	ENG	51.47	-0.07
Barnsley	ENG	53.55	-1.48
Lowestoft	ENG	52.48	1.75
Gosport	ENG	50.8	-1.13
Southall	ENG	51.51	-0.37
Stafford	ENG	52.81	-2.12
Royal Tunbridge Wells	ENG	51.13	0.26
Ellesmere Port	ENG	53.28	-2.9
Rossendale	ENG	53.68	-2.28
Folkestone	ENG	51.08	1.17
Brixton	ENG	51.47	-0.11
Hounslow	ENG	51.47	-0.36
Wrexham	WLS	53.05	-2.99
Torquay	ENG	50.46	-3.53
Maidenhead	ENG	51.52	-0.72
Kingswood	ENG	51.45	-2.51
Taunton	ENG	51.01	-3.1
Waterlooville	ENG	50.88	-1.03
Macclesfield	ENG	53.26	-2.13
Bognor Regis	ENG	50.78	-0.68
Newtownabbey	NIR	54.66	-5.91
Kettering	ENG	52.4	-0.73
Buckley	WLS	53.17	-3.08
Great Yarmouth	ENG	52.61	1.73
Runcorn	ENG	53.34	-2.73
Ashford	ENG	51.15	0.87
Tonypandy	WLS	51.62	-3.46
Scarborough	ENG	54.28	-0.4
Widnes	ENG	53.36	-2.73
Aldershot	ENG	51.25	-0.76
Bury	ENG	53.6	-2.3
Barking	ENG	51.53	0.08
Castleford	ENG	53.73	-1.36
Hereford	ENG	52.06	-2.71
Bangor	NIR	54.65	-5.67
Stroud	ENG	51.75	-2.2
Margate	ENG	51.38	1.39
Chelsea	ENG	51.49	-0.17
Loughborough	ENG	52.77	-1.2
Welwyn Garden City	ENG	51.8	-0.21
Farnborough	ENG	51.29	-0.76
Rhondda	WLS	51.66	-3.45
Craigavon	NIR	54.45	-6.39
Wallasey	ENG	53.42	-3.06
Littlehampton	ENG	50.81	-0.54
Bridgend	WLS	51.51	-3.58
Bootle	ENG	53.47	-3.02
Weymouth	ENG	50.61	-2.46
Fareham	ENG	50.85	-1.18
Morley	ENG	53.74	-1.6
Cheshunt	ENG	51.7	-0.03
Kidderminster	ENG	52.39	-2.25
Corby	ENG	52.5	-0.69
Dartford	ENG	51.45	0.21
Castlereagh	NIR	54.57	-5.88
Dewsbury	ENG	53.69	-1.63
Livingston	SCT	55.9	-3.52
Stourbridge	ENG	52.46	-2.14
Sale	ENG	53.43	-2.32
Halesowen	ENG	52.45	-2.05
Canterbury	ENG	51.28	1.08
South Croydon	ENG	51.36	-0.09
Huyton	ENG	53.41	-2.84
Barry	WLS	51.4	-3.28
Gravesend	ENG	51.44	0.37
Eastleigh	ENG	50.97	-1.35
Acton	ENG	51.51	-0.28
Washington	ENG	54.9	-1.52
Braintree	ENG	51.88	0.55
Hamilton	SCT	55.77	-4.03
Brentwood	ENG	51.62	0.31
Esher	ENG	51.37	-0.37
Crosby	ENG	53.48	-3.03
Reigate	ENG	51.24	-0.21
Dunstable	ENG	51.89	-0.52
Morecambe	ENG	54.07	-2.86
Cumbernauld	SCT	55.95	-3.99
Redhill	ENG	51.24	-0.17
Horsham	ENG	51.06	-0.33
Staines	ENG	51.43	-0.51
Batley	ENG	53.7	-1.63
Wellingborough	ENG	52.3	-0.69
Clacton-on-Sea	ENG	51.79	1.16
Dunfermline	SCT	56.07	-3.46
Bletchley	ENG	51.99	-0.73
Keighley	ENG	53.87	-1.91
Hayes	ENG	51.52	-0.42
#GE
Tbilisi	51	41.69	44.83
Kutaisi	66	42.27	42.69
Batumi	04	41.64	41.63
Sokhumi	02	43.01	40.99
Zugdidi	71	42.51	41.87
Rustavi	68	41.56	44.98
#GF
Cayenne	GF	4.93	-52.33
#GH
Accra	01	5.56	-0.2
Kumasi	02	6.69	-1.62
Tamale	06	9.4	-0.84
Takoradi	09	4.9	-1.76
Atsiaman	01	5.7	-0.33
Tema	01	5.67	-0.02
Teshi Old Town	01	5.58	-0.11
Cape Coast	04	5.11	-1.25
Sekondi-Takoradi	09	4.93	-1.76
Obuase	02	6.2	-1.67
Medina Estates	01	5.67	-0.16
Koforidua	05	6.09	-0.26
Japekrom	13	7.58	-2.79
Wa	11	10.06	-2.5
Ejura	02	7.39	-1.36
Nungua	01	5.6	-0.08
Sunyani	13	7.34	-2.33
Ho	08	6.6	0.47
Techiman	14	7.59	-1.94
Aflao	08	6.12	1.19
Berekum	13	7.45	-2.58
Akim Oda	05	5.93	-0.99
Bawku	10	11.06	-0.24
Hohoe	08	7.15	0.47
Bolgatanga	10	10.79	-0.85
Tafo	02	6.73	-1.61
Swedru	04	5.54	-0.7
#GM
Serekunda	01	13.44	-16.68
Brikama	05	13.27	-16.65
#GN
Camayenne	04	9.54	-13.69
Conakry	04	9.54	-13.68
Nzérékoré	N	7.76	-8.82
Kindia	D	10.06	-12.87
Kankan	K	10.39	-9.31
Gueckedou	N	8.57	-10.13
Coyah	D	9.71	-13.38
Labé	L	11.32	-12.28
#GP
Les Abymes	GP	16.27	-61.51
#GQ
Bata	08	1.86	9.77
Malabo	04	3.76	8.78
#GR
Athens	ESYE31	37.98	23.73
Thessaloníki	ESYE12	40.64	22.93
Pátra	ESYE23	38.24	21.73
Piraeus	ESYE31	37.94	23.65
Lárisa	ESYE14	39.64	22.42
Peristéri	ESYE31	38.02	23.69
Irákleion	ESYE43	35.33	25.14
Kallithéa	ESYE31	37.95	23.7
Acharnés	ESYE31	38.08	23.73
Kalamariá	ESYE12	40.58	22.95
Níkaia	ESYE31	37.97	23.65
Glyfáda	ESYE31	37.86	23.76
Volos	ESYE14	39.36	22.94
Ílion	ESYE31	38.03	23.7
Ilioúpoli	ESYE31	37.93	23.77
Keratsíni	ESYE31	37.96	23.62
Khalándrion	ESYE31	38.02	23.8
Néa Smýrni	ESYE31	37.95	23.71
Maroúsi	ESYE31	38.05	23.8
Agios Dimitrios	ESYE31	37.93	23.73
Zográfos	ESYE31	37.98	23.77
Aigáleo	ESYE31	37.98	23.68
Néa Ionía	ESYE31	38.04	23.76
Ioánnina	ESYE21	39.66	20.85
Palaió Fáliro	ESYE31	37.93	23.7
Korydallós	ESYE31	37.98	23.65
Tríkala	ESYE14	39.55	21.77
Výronas	ESYE31	37.96	23.75
Agía Paraskeví	ESYE31	38.02	23.83
Galátsi	ESYE31	38.02	23.75
Chalkída	ESYE24	38.46	23.6
Petroúpolis	ESYE31	38.04	23.68
Sérres	ESYE12	41.08	23.55
Ródos	ESYE42	36.44	28.22
Kalamata	ESYE25	37.04	22.11
Kavála	ESYE11	40.94	24.41
Chaniá	ESYE43	35.51	24.03
Kateríni	ESYE12	40.27	22.51
Alexandroupoli	ESYE11	40.85	25.88
Lamía	ESYE24	38.9	22.43
#GT
Guatemala City	07	14.64	-90.51
Mixco	07	14.63	-90.61
Villa Nueva	07	14.53	-90.59
Petapa	07	14.5	-90.56
San Juan Sacatepéquez	07	14.72	-90.64
Quetzaltenango	13	14.83	-91.52
Villa Canales	07	14.48	-90.53
Escuintla	06	14.3	-90.79
Chinautla	07	14.7	-90.5
Chimaltenango	03	14.66	-90.82
Chichicastenango	14	14.94	-91.11
Huehuetenango	08	15.32	-91.47
Amatitlán	07	14.48	-90.63
Totonicapán	21	14.91	-91.36
Santa Catarina Pinula	07	14.57	-90.5
Santa Lucía Cotzumalguapa	06	14.34	-91.02
Puerto Barrios	09	15.73	-88.59
San Francisco El Alto	21	14.94	-91.44
Cobán	01	15.47	-90.37
#GW
Bissau	11	11.86	-15.6
#GY
Georgetown	12	6.8	-58.16
#HK
Hong Kong	HCW	22.28	114.17
Kowloon	KKC	22.32	114.18
Tsuen Wan	NTW	22.37	114.11
Yuen Long Kau Hui	NYL	22.45	114.03
#HN
Tegucigalpa	08	14.08	-87.21
San Pedro Sula	06	15.5	-88.02
Choloma	06	15.61	-87.95
La Ceiba	01	15.76	-86.78
El Progreso	18	15.4	-87.8
Ciudad Choluteca	02	13.3	-87.19
Comayagua	04	14.45	-87.64
#HR
Zagreb	21	45.81	15.98
Split	15	43.51	16.44
Rijeka	12	45.33	14.44
Osijek	10	45.55	18.69
Zadar	19	44.12	15.23
Slavonski Brod	02	45.16	18.02
Pula	04	44.87	13.85
Sesvete	21	45.83	16.12
#HT
Port-au-Prince	11	18.54	-72.34
Carrefour	11	18.54	-72.4
Delmas 73	11	18.54	-72.3
Pétionville	11	18.51	-72.29
Port-de-Paix	03	19.94	-72.83
Croix-des-Bouquets	11	18.58	-72.23
Jacmel	13	18.23	-72.54
Okap	09	19.76	-72.2
Léogâne	11	18.51	-72.63
Les Cayes	12	18.19	-73.75
Tigwav	11	18.43	-72.87
Jérémie	14	18.65	-74.12
Miragoâne	15	18.45	-73.09
Gonaïves	06	19.45	-72.69
Saint-Marc	06	19.11	-72.69
Thomazeau	11	18.65	-72.09
#HU
Budapest	05	47.5	19.04
Debrecen	10	47.53	21.62
Miskolc	04	48.1	20.78
Szeged	06	46.25	20.15
Pécs	02	46.07	18.23
Budapest XI. kerület	05	47.48	19.04
Zugló	05	47.52	19.11
Győr	09	47.68	17.64
Budapest III. kerület	05	47.54	19.05
Nyíregyháza	18	47.96	21.72
Budapest XIII. kerület	05	47.53	19.08
Kecskemét	01	46.91	19.69
Székesfehérvár	08	47.19	18.41
Budapest IV. kerület	05	47.56	19.09
Budapest XVIII. kerület	05	47.44	19.18
Budapest II. kerület	05	47.52	19.02
Budapest VIII. kerület	05	47.49	19.07
Budapest XV. kerület	05	47.56	19.12
Szombathely	22	47.23	16.62
Kőbánya	05	47.48	19.14
Budapest XVII. kerület	05	47.48	19.25
Józsefváros	05	47.49	19.07
Budapest XXI. kerület	05	47.43	19.07
Parádsasvár	11	47.91	19.98
Szolnok	20	47.18	20.2
Tatabánya	12	47.58	18.39
Budapest XVI. kerület	05	47.51	19.17
Kaposvár	17	46.37	17.8
Békéscsaba	03	46.68	21.1
Budapest XX. kerület	05	47.44	19.1
Érd	16	47.39	18.91
Veszprém	23	47.09	17.91
Erzsébetváros	05	47.5	19.07
Zalaegerszeg	24	46.84	16.84
Budapest XIX. kerület	05	47.45	19.15
Kispest	05	47.45	19.14
Sopron	09	47.69	16.59
Eger	11	47.9	20.37
Budapest XII. kerület	05	47.49	19.01
Nagykanizsa	24	46.45	16.99
Budapest XXII. kerület	05	47.43	19.04
Dunaújváros	08	46.96	18.94
#ID
Jakarta	04	-6.21	106.85
Surabaya	08	-7.25	112.75
Medan	26	3.58	98.67
Bandung	30	-6.92	107.61
Bekasi	30	-6.23	106.99
Palembang	32	-2.92	104.75
Tangerang	33	-6.18	106.63
Makassar	38	-5.15	119.43
South Tangerang	33	-6.29	106.72
Semarang	07	-6.99	110.42
Depok	30	-6.4	106.82
Batam	37	1.15	104.02
Padang	24	-0.95	100.35
Denpasar	02	-8.65	115.22
Bandar Lampung	15	-5.43	105.26
Bogor	30	-6.59	106.79
Malang	08	-7.98	112.63
Pekanbaru	37	0.52	101.44
City of Balikpapan	14	-1.24	116.89
Yogyakarta	10	-7.8	110.36
Situbondo	08	-7.71	114.01
Banjarmasin	12	-3.32	114.59
Surakarta	07	-7.56	110.83
Cimahi	30	-6.87	107.54
Pontianak	11	-0.03	109.33
Manado	31	1.48	124.85
Balikpapan	14	-1.27	116.83
Jambi City	05	-1.6	103.62
Ambon	28	-3.7	128.18
Samarinda	14	-0.49	117.15
Mataram	17	-8.58	116.12
Percut	26	3.63	98.86
Bengkulu	03	-3.8	102.27
Jember	08	-8.17	113.7
Palu	21	-0.91	119.87
Kupang	18	-10.17	123.61
Sukabumi	30	-6.92	106.93
Tasikmalaya	30	-7.33	108.22
Pekalongan	07	-6.89	109.68
Cirebon	30	-6.71	108.56
Banda Aceh	01	5.54	95.33
Tegal	07	-6.87	109.14
Kediri	08	-7.82	112.02
Binjai	26	3.6	98.49
Purwokerto	07	-7.42	109.23
Purwakarta	30	-6.56	107.44
Loa Janan	14	-0.58	117.1
Pematangsiantar	26	2.96	99.07
Ciputat	30	-6.24	106.7
Ciampea	30	-6.55	106.7
Cileungsir	30	-6.39	106.96
Rengasdengklok	30	-6.16	107.3
Sumedang	30	-6.86	107.92
Kendari	22	-3.98	122.52
Parung	30	-6.42	106.73
Tanjung Pinang	40	0.92	104.46
Curug	33	-6.27	106.56
Labuan Bajo	18	-8.5	119.89
Cibinong	30	-6.48	106.85
Madiun	08	-7.63	111.52
Pemalang	07	-6.89	109.38
Lembang	30	-6.81	107.62
Probolinggo	08	-7.75	113.22
Pamulang	30	-6.34	106.74
Cikupa	30	-6.24	106.51
Salatiga	07	-7.33	110.49
Plumbon	30	-6.7	108.47
Banjaran	30	-7.05	107.59
Serang	33	-6.12	106.15
Lawang	08	-7.84	112.69
Pasuruan	08	-7.65	112.91
Sunggal	26	3.58	98.62
Perbaungan	26	3.57	98.96
Pasarkemis	30	-6.17	106.53
Soreang	30	-7.03	107.52
Purwodadi	07	-7.09	110.92
Metro	15	-5.11	105.31
Lubuklinggau	32	-3.29	102.86
Palangkaraya	13	-2.21	113.92
Astanajapura	30	-6.8	108.63
Cikampek	30	-6.42	107.46
Gorontalo	34	0.54	123.06
Dumai	37	1.67	101.44
Tanjungbalai	26	2.97	99.8
Parepare	38	-4.01	119.63
Sidoarjo	08	-7.45	112.72
Weru	30	-6.71	108.5
Jayapura	36	-2.53	140.72
Baturaja	32	-4.13	104.17
Adiwerna	07	-6.94	109.13
Singaraja	02	-8.11	115.09
Blitar	08	-8.1	112.17
Martapura	12	-3.41	114.86
Kisaran	26	2.98	99.62
Palopo	38	-2.99	120.2
Teluknaga	30	-6.1	106.64
Ungaran	07	-7.14	110.41
Rangkasbitung	33	-6.36	106.25
Klaten	07	-7.71	110.61
Jombang	08	-7.55	112.23
Paseh	30	-7.1	107.76
Pangkalpinang	35	-2.13	106.11
Sorong	39	-0.88	131.26
Padalarang	30	-6.84	107.47
Ciamis	30	-7.33	108.35
Lumajang	08	-8.13	113.22
Indramayu	30	-6.33	108.32
Pati	07	-6.76	111.04
Payakumbuh	24	-0.22	100.63
Bangil	08	-7.6	112.82
Sepatan	30	-6.12	106.58
Tebingtinggi	26	3.33	99.16
Kedungwuni	07	-6.97	109.65
Batang	07	-6.48	110.71
Pamanukan	30	-6.28	107.81
Sawangan	30	-6.4	106.77
Mojokerto	08	-7.47	112.43
Cileunyi	30	-6.94	107.75
Magelang	07	-7.47	110.22
Kresek	30	-6.13	106.38
Citeureup	30	-6.49	106.88
Banyuwangi	08	-8.23	114.36
Cikarang	30	-6.26	107.15
Arjawinangun	30	-6.65	108.41
Depok	10	-7.76	110.43
Prabumulih	32	-3.43	104.23
Rantauprapat	26	2.1	99.83
Belawan	26	3.78	98.68
Singkawang	11	0.91	108.98
Ternate	29	0.79	127.38
Bontang	14	0.13	117.49
Grogol	07	-7.6	110.82
Padangsidempuan	26	1.38	99.27
Sumedang Utara	30	-6.85	107.92
Bukittinggi	24	-0.31	100.37
Dukuhturi	07	-6.9	109.08
Tarakan	42	3.31	117.59
Sungai Penuh	05	-2.06	101.39
Sumber	30	-6.76	108.48
Wonosobo	07	-7.36	109.9
Palimanan	30	-6.71	108.42
Pamekasan	08	-7.16	113.47
Pandeglang	33	-6.31	106.11
Pariaman	24	-0.62	100.12
Kudus	07	-6.8	110.84
Caringin	30	-6.71	106.82
Banjar	02	-8.19	114.97
Lhokseumawe	01	5.18	97.15
Cicurug	30	-6.78	106.78
Kartasura	07	-7.55	110.74
Klangenan	30	-6.71	108.44
Majalengka	30	-6.84	108.23
Bojonegoro	08	-7.15	111.88
Kasihan	10	-7.83	110.33
Sumenep	08	-7.02	113.87
Ambarawa	07	-7.26	110.4
Margahayukencana	30	-6.97	107.57
Galesong	38	-5.32	119.37
Watampone	38	-4.54	120.33
Kedungwaru	08	-8.07	111.92
Serpong	30	-6.32	106.66
Sibolga	26	1.74	98.78
Genteng	08	-8.37	114.15
Gedangan	08	-7.39	112.73
Ponorogo	08	-7.87	111.46
Ciranjang-hilir	30	-6.82	107.26
Ende	18	-8.84	121.66
Tuban	08	-6.9	112.06
Kebomas	08	-7.17	112.63
Karangsembung	30	-6.85	108.64
Tarub	07	-6.93	109.17
Batu	08	-7.87	112.53
Sungailiat	35	-1.85	106.12
Gresik	08	-7.15	112.66
Sewon	10	-7.88	110.36
Jatibarang	30	-6.47	108.32
Kuningan	30	-6.98	108.48
Sragen	07	-7.43	111.02
Pagar Alam	32	-4.03	103.25
Mertoyudan	07	-7.52	110.23
Bondowoso	08	-7.91	113.82
Nganjuk	08	-7.61	111.9
Melati	10	-7.73	110.37
Bima	17	-8.46	118.73
Sokaraja	07	-7.46	109.29
Gamping Lor	10	-7.8	110.33
Sampit	13	-2.53	112.95
Lahat	32	-3.79	103.54
Tulungagung	08	-8.07	111.9
Muncar	08	-8.43	114.33
Tulangan Utara	08	-7.47	112.65
Godean	10	-7.77	110.29
Tanjung Pandan	35	-2.73	107.63
Abepura	36	-2.6	140.63
Bangkalan	08	-7.05	112.74
Slawi	07	-6.98	109.14
Pecangaan	07	-6.7	110.71
Kertosono	08	-7.58	112.1
Barabai	12	-2.58	115.38
Boyolali	07	-7.53	110.6
Sengkang	38	-4.13	120.03
Lamongan	08	-7.12	112.42
Baki	07	-7.61	110.78
Bantul	10	-7.89	110.33
Weleri	07	-6.97	110.07
Polewali	41	-3.43	119.34
Jatiwangi	30	-6.73	108.26
Baekrajan	07	-6.77	110.85
Singosari	08	-7.89	112.67
Kabanjahe	26	3.1	98.49
Purbalingga	07	-7.39	109.36
Pare	08	-7.77	112.2
Balaipungut	37	1.06	101.29
Mendaha	05	-1.02	103.59
Sleman	10	-7.72	110.36
Pandak	10	-7.91	110.29
Amuntai	12	-2.42	115.25
Besuki	08	-7.73	113.7
Wedi	07	-7.74	110.58
Cepu	07	-7.15	111.59
Langsa	01	4.47	97.97
Sampang	08	-7.19	113.24
Manokwari	39	-0.86	134.06
Tanjungagung	32	-3.94	103.8
Sumbawa Besar	17	-8.49	117.42
Terbanggi Besar	15	-4.88	105.22
Kepanjen	08	-8.13	112.57
Blora	07	-6.97	111.42
Comal	07	-6.91	109.53
Karanganom	07	-7.65	110.63
Kawalu	30	-7.38	108.21
Jatiroto	07	-7.88	111.12
#IE
Dublin	L	53.33	-6.25
Cork	M	51.9	-8.47
Luimneach	M	52.66	-8.62
Gaillimh	C	53.27	-9.05
Tallaght	L	53.29	-6.37
#IL
Jerusalem	06	31.77	35.22
Tel Aviv	05	32.08	34.78
West Jerusalem	06	31.78	35.22
Haifa	04	32.82	34.99
Ashdod	01	31.79	34.65
Rishon LeẔiyyon	02	31.97	34.79
Petaẖ Tiqwa	02	32.09	34.89
Beersheba	01	31.25	34.79
Netanya	02	32.33	34.86
H̱olon	05	32.01	34.78
Bnei Brak	05	32.08	34.83
Reẖovot	02	31.89	34.81
Bat Yam	05	32.02	34.75
Ramat Gan	05	32.08	34.81
Ashkelon	01	31.67	34.57
Jaffa	05	32.05	34.75
Modi‘in Makkabbim Re‘ut	02	31.89	35.02
Herzliya	05	32.17	34.83
Kfar Saba	02	32.17	34.91
Ra'anana	02	32.18	34.87
Hadera	04	32.44	34.9
Bet Shemesh	06	31.73	34.99
Lod	02	31.95	34.89
Nazareth	03	32.7	35.3
Modiin Ilit	06	31.93	35.04
Ramla	02	31.93	34.87
Nahariyya	03	33.01	35.1
#IN
Mumbai	16	19.07	72.88
Delhi	07	28.65	77.23
Bengaluru	19	12.97	77.59
Kolkata	28	22.56	88.36
Chennai	25	13.09	80.28
Ahmedabad	09	23.03	72.59
Hyderabad	40	17.38	78.46
Pune	16	18.52	73.86
Sūrat	09	21.2	72.83
Kanpur	36	26.47	80.35
Jaipur	24	26.92	75.79
Navi Mumbai	16	19.04	73.02
Lucknow	36	26.84	80.92
Nagpur	16	21.15	79.08
Indore	35	22.72	75.83
Patna	34	25.59	85.14
Bhopal	35	23.25	77.4
Ludhiāna	23	30.91	75.85
Tirunelveli	25	8.73	77.68
Agra	36	27.18	78.02
Vadodara	09	22.3	73.21
Najafgarh	07	28.61	76.98
Gorakhpur	10	29.45	75.67
Nashik	16	20	73.79
Pimpri	16	18.62	73.81
Kalyān	16	19.24	73.14
Thāne	16	19.2	72.96
Meerut	36	28.98	77.71
Nowrangapur	21	19.23	82.55
Faridabad	10	28.41	77.31
Ghāziābād	36	28.67	77.44
Dombivli	16	19.22	73.08
Rājkot	09	22.29	70.79
Varanasi	36	25.32	83.01
Amritsar	23	31.62	74.88
Allahābād	36	25.44	81.84
Visakhapatnam	02	17.68	83.2
Teni	25	10.01	77.48
Jabalpur	35	23.17	79.95
Hāora	28	22.58	88.32
Aurangabad	16	19.88	75.34
Shivaji Nagar	16	18.53	73.85
Solāpur	16	17.67	75.91
Srinagar	12	34.09	74.81
Chandigarh	05	30.74	76.79
Coimbatore	25	11.01	76.97
Jodhpur	24	26.27	73.01
Madurai	25	9.92	78.12
Guwahati	03	26.18	91.75
Gwalior	35	26.23	78.17
Vijayawada	02	16.51	80.65
Mysore	19	12.3	76.64
Rohini	07	28.74	77.07
Ranchi	38	23.34	85.31
Hubli	19	15.35	75.13
Narela	07	28.85	77.09
Jalandhar	23	31.33	75.58
Thiruvananthapuram	13	8.49	76.95
Salem	25	11.65	78.16
Tiruchirappalli	25	10.82	78.7
Kota	24	25.18	75.84
Bhubaneshwar	21	20.27	85.83
Alīgarh	36	27.88	78.07
Bareilly	36	28.37	79.43
Morādābād	36	28.84	78.78
Bhiwandi	16	19.3	73.06
Raipur	37	21.23	81.63
Gorakhpur	36	26.77	83.37
Bhilai	37	21.21	81.43
Jamshedpur	38	22.8	86.19
Borivli	16	19.23	72.86
Cochin	13	9.94	76.26
Amrāvati	16	20.93	77.75
Sāngli	16	16.85	74.56
Cuttack	21	20.46	85.88
Bīkaner	24	28.02	73.31
Warangal	40	18	79.58
Bhavnagar	09	21.76	72.15
Nanded	16	19.16	77.31
Raurkela	21	22.22	84.86
Guntur	02	16.3	80.46
Dehra Dūn	39	30.32	78.03
Bhayandar	16	19.3	72.85
Durgapur	28	23.52	87.31
Ajmer	24	26.45	74.64
Ulhasnagar	16	19.22	73.15
Kolhāpur	16	16.7	74.23
Siliguri	28	26.71	88.43
Bilimora	09	20.77	72.96
Karol Bāgh	07	28.65	77.19
Āsansol	28	23.68	86.98
Jamnagar	09	22.47	70.07
Sahāranpur	36	29.97	77.55
Gulbarga	19	17.34	76.84
Bhātpāra	28	22.87	88.4
Jammu	12	32.74	74.87
Kurnool	02	15.83	78.04
Ujjain	35	23.18	75.78
Rāmgundam	40	18.8	79.45
Shyamnagar	28	22.83	88.37
Nangi	28	22.51	88.22
Kozhikode	13	11.25	75.78
Mālegaon	16	20.55	74.53
Davangere	19	14.47	75.93
Jalgaon	16	21	75.57
Akola	16	20.71	77
Belgaum	19	15.85	74.5
Gaya	34	24.8	85
Udaipur	24	24.59	73.71
Korba	37	22.35	82.7
Bokāro	38	23.79	85.96
Mangalore	19	12.92	74.86
Jhānsi	36	25.46	78.58
Thoothukudi	25	8.77	78.13
Nellore	02	14.45	79.99
Tiruppur	25	11.12	77.35
Kollam	13	8.88	76.58
Pānihāti	28	22.69	88.37
Ahmadnagar	16	19.09	74.74
Dhūlia	16	20.9	74.78
Bhāgalpur	34	25.24	86.97
Punāsa	35	22.24	76.39
Muzaffarnagar	36	29.47	77.7
Latur	16	18.4	76.57
Kūkatpalli	40	17.48	78.41
Ambattūr	25	13.1	80.16
Bellary	19	15.14	76.92
Muzaffarpur	34	26.12	85.39
Kāmārhāti	28	22.67	88.37
Mathura	36	27.5	77.67
Patiāla	23	30.34	76.39
Chānda	16	19.95	79.3
Bhīlwāra	24	25.35	74.64
Thrissur	13	10.52	76.22
Brahmapur	21	19.31	84.79
Shāhjānpur	36	27.88	79.91
Shimoga	19	13.93	75.57
New Delhi	07	28.64	77.22
Rohtak	10	28.89	76.59
Tumkūr	19	13.34	77.1
Fīrozābād	36	27.15	78.4
Nizāmābād	40	18.67	78.1
Kulti	28	23.73	86.84
Rājahmundry	02	17.01	81.78
Barddhamān	28	23.26	87.86
Bārāsat	28	22.72	88.48
Bāli	28	22.65	88.34
Hisar	10	29.15	75.72
Rāmpur	36	28.81	79.03
Greater Noida	36	28.5	77.54
Noida	36	28.58	77.33
Kākināda	02	16.96	82.24
Pānīpat	10	29.39	76.97
Parbhani	16	19.27	76.77
Darbhanga	34	26.15	85.9
Alwar	24	27.56	76.63
Bilāspur	37	22.08	82.16
Ichalkaranji	16	16.69	74.46
Bijapur	19	16.82	75.72
Aizawl	31	23.73	92.72
Jālna	16	19.84	75.89
Lal Bahadur Nagar	40	17.35	78.56
Dewas	35	22.97	76.06
Baranagar	28	22.64	88.38
Gajuwaka	02	17.7	83.22
Satna	35	24.58	80.83
Etāwah	36	26.78	79.02
Durg	37	21.19	81.28
Naihāti	28	22.89	88.42
Tirupati	02	13.64	79.42
Sonīpat	10	28.99	77.02
Āvadi	25	13.11	80.11
Tiruvottiyūr	25	13.16	80.3
Saugor	35	23.84	78.74
Mau	36	25.94	83.56
Bihār Sharīf	34	25.2	85.52
Hāpur	36	28.73	77.78
Bathinda	23	30.21	74.94
Farrukhābād	36	27.39	79.58
Anantapur	02	14.68	77.61
Ratlām	35	23.33	75.04
Ramagundam	40	18.76	79.47
Gangānagar	24	29.92	73.87
Bharatpur	24	27.22	77.49
Karīmnagar	40	18.44	79.13
Puducherry	22	11.93	79.83
Shrīrāmpur	28	22.75	88.34
Rāichūr	19	16.21	77.36
Quthbullapur	40	17.5	78.46
Karnāl	10	29.69	76.98
Arrah	34	25.56	84.66
Imphal	17	24.81	93.94
Gosāba	28	22.17	88.8
Mirzāpur	36	25.14	82.57
Kharagpur	28	22.34	87.33
Dhanbād	38	23.8	86.44
Tanjore	25	10.79	79.14
Amarnāth	16	19.2	73.17
Nāgercoil	25	8.18	77.43
Pāli	24	25.77	73.32
Yamunānagar	10	30.13	77.28
Rewa	35	24.53	81.29
Secunderabad	40	17.5	78.54
Bīdar	19	17.91	77.52
Agartala	26	23.84	91.28
Monghyr	34	25.37	86.47
Burhānpur	35	21.31	76.23
Nadiād	09	22.69	72.86
Chāpra	34	25.78	84.75
Dindigul	25	10.37	77.98
Panchkula	10	30.69	76.85
Sīkar	24	27.61	75.14
Bulandshahr	36	28.4	77.86
Purnia	34	25.78	87.47
Hospet	19	15.27	76.39
Gurgaon	10	28.46	77.03
Sambhal	36	28.58	78.57
Gandhinagar	09	23.22	72.68
Murwāra	35	23.84	80.39
Nāngloi Jāt	07	28.68	77.07
Machilīpatnam	02	16.19	81.14
Katihar	34	25.54	87.57
Bhiwāni	10	28.79	76.14
Kultali	28	21.9	88.4
Raebareli	36	26.23	81.23
Haridwar	39	29.95	78.16
Singrauli	35	24.2	82.68
Jūnāgadh	09	21.52	70.46
Sūjāngarh	24	27.7	74.47
Ellore	02	16.71	81.1
Bhusāval	16	21.04	75.79
Khandwa	35	21.82	76.35
Bahraigh	36	27.57	81.59
Sirsa	10	29.53	75.03
Chandannagar	28	22.86	88.37
Baharampur	28	24.1	88.25
Surendranagar	09	22.73	71.65
Vizianagaram	02	18.12	83.41
Proddatūr	02	14.75	78.55
Vellore	25	12.92	79.13
Hugli	28	22.91	88.4
Alappuzha	13	9.49	76.33
Amroha	36	28.9	78.47
Tambaram	25	12.92	80.13
Pathānkot	23	32.27	75.65
Bhind	35	26.57	78.79
Shimla	11	31.1	77.17
Ongole	02	15.5	80.04
Gadag-Betageri	19	15.42	75.62
Navsāri	09	20.94	72.92
Puri	21	19.8	85.82
Haldia	28	22.06	88.11
Khammam	40	17.25	80.14
Rāiganj	28	25.61	88.12
Ingrāj Bāzār	28	25	88.15
Jaunpur	36	25.75	82.69
Fatehpur	36	25.93	80.81
Gāndhīdhām	09	23.08	70.13
Nandyāl	02	15.48	78.48
Udupi	19	13.33	74.75
Loni	36	28.75	77.29
Sītāpur	36	27.56	80.68
Shivpuri	35	25.42	77.66
Bhadrāvati	19	13.85	75.71
Ādoni	02	15.63	77.27
Verāval	09	20.91	70.37
Sambalpur	21	21.47	83.98
Gadag	19	15.43	75.63
Unnāo	36	26.55	80.49
Budaun	36	28.04	79.13
Jīnd	10	29.32	76.32
Madhyamgram	28	22.69	88.45
Jāmuria	28	23.7	87.08
Jaigaon	28	26.85	89.38
Cuddalore	25	11.76	79.77
Orai	36	25.99	79.45
Hoshiārpur	23	31.54	75.91
Pallāvaram	25	12.97	80.15
Hanumāngarh	24	29.58	74.33
Kanchipuram	25	12.84	79.7
Alandur	25	13	80.21
Guna	35	24.65	77.31
Bahādurgarh	10	28.69	76.94
Bharūch	09	21.69	72.98
Medinīpur	28	22.42	87.32
Fyzābād	36	26.78	82.15
Dinapore	34	25.64	85.05
Silchar	03	24.83	92.8
Bānda	36	25.48	80.33
Morena	35	26.5	78
Tonk	24	26.17	75.79
Rāj-Nāndgaon	37	21.1	81.03
Serilingampalle	40	17.49	78.3
Virār	16	19.46	72.81
Malkajgiri	40	17.45	78.53
Shāntipur	28	23.25	88.43
Bārākpur	28	22.77	88.36
Erode	25	11.34	77.73
Ambāla	10	30.36	76.8
Krishnanagar	28	23.41	88.49
Saharsa	34	25.87	86.6
Batāla	23	31.81	75.2
Bhīmavaram	02	16.54	81.52
Bālurghāt	28	25.22	88.78
Kaithal	10	29.8	76.4
Lakhīmpur	36	27.95	80.78
Hazāribāgh	38	23.99	85.36
Vidisha	35	23.53	77.81
Haldwani	39	29.22	79.53
Hābra	28	22.84	88.66
Kumbakonam	25	10.96	79.39
Porbandar	09	21.64	69.61
Chitradurga	19	14.22	76.4
Thānesar	10	29.97	76.83
Tiruvannāmalai	25	12.23	79.07
Anand	09	22.55	72.96
Kānchrāpāra	28	22.96	88.43
Mahbūbnagar	40	16.74	77.99
Dimāpur	20	25.91	93.72
Robertsonpet	19	12.96	78.28
Chhindwāra	35	22.06	78.94
Mandya	19	12.52	76.9
Bānkura	28	23.23	87.07
Hājīpur	34	25.69	85.21
Gondā City	36	27.13	81.95
Bhuj	09	23.25	69.67
Hindupur	02	13.83	77.49
Shillong	18	25.57	91.88
Pālghāt	13	10.77	76.65
Godhra	09	22.78	73.61
Kishangarh	24	26.59	74.85
Rānīganj	28	23.62	87.13
Pīlibhīt	36	28.63	79.8
Beāwar	24	26.1	74.32
Abohar	23	30.14	74.2
Moga	23	30.81	75.17
Dehri	34	24.9	84.18
Deoria	36	26.5	83.78
Hassan	19	13.01	76.1
Khardah	28	22.72	88.38
Yavatmāl	16	20.39	78.13
Hālīsahar	28	22.93	88.42
Panvel	16	18.99	73.11
Titāgarh	28	22.74	88.37
Cuddapah	02	14.48	78.82
Bettiah	34	26.8	84.5
Hāthras	36	27.6	78.05
Lalitpur	36	24.69	78.42
Kolār	19	13.14	78.13
Mandsaur	35	24.07	75.07
Gondiā	16	21.46	80.19
Rajapalaiyam	25	9.45	77.55
Dārjiling	28	27.03	88.27
Mohali	23	30.68	76.72
Pālanpur	09	24.17	72.44
Dam Dam	28	22.63	88.42
Hardoī	36	27.39	80.13
Puruliya	28	23.33	86.36
Dibrugarh	03	27.48	94.91
Palwal	10	28.14	77.33
Nalgonda	40	17.05	79.27
Bhadreswar	28	22.82	88.34
Vejalpur	09	22.69	73.56
Chikmagalūr	19	13.32	75.77
Raigarh	37	21.9	83.4
Guntakal Junction	02	15.17	77.36
Gangāpur	24	26.47	76.72
Deoli	07	28.5	77.23
Siwān	34	26.22	84.36
Damoh	35	23.83	79.44
Ādilābād	40	19.67	78.54
Srikakulam	02	18.3	83.9
Uppal Kalan	40	17.41	78.56
Jetpur	09	21.75	70.62
Morbi	09	22.82	70.84
Pātan	09	23.85	72.13
Khanna	23	30.71	76.22
Botād	09	22.17	71.67
Rishra	28	22.72	88.35
Azamgarh	36	26.07	83.18
Yelahanka	19	13.1	77.6
Gudivāda	02	16.44	81
Baidyabāti	28	22.78	88.33
Bastī	36	26.79	82.72
Balasore	21	21.49	86.93
Dharmavaram	02	14.41	77.72
Māler Kotla	23	30.53	75.88
Wardha	16	20.74	78.6
Jhunjhunūn	24	28.13	75.4
Satara	16	17.69	73.99
Chanduasi	36	28.45	78.78
Mothīhāri	34	26.65	84.92
Chās	38	23.64	86.17
Pudukkottai	25	10.38	78.82
Rewāri	10	28.2	76.62
Port Blair	01	11.67	92.75
Suriāpet	40	17.14	79.62
Bangaon	28	23.05	88.83
Chhatarpur	35	24.92	79.59
Ashoknagar Kalyangarh	28	22.86	88.64
Achalpur	16	21.26	77.51
Navadwīp	28	23.41	88.37
Bārsi	16	18.23	75.69
Sultānpur	36	26.26	82.07
Ambur	25	12.79	78.72
Hoshangābād	35	22.75	77.73
Sawāi Mādhopur	24	26.02	76.34
Madanapalle	02	13.55	78.5
Bānsbāria	28	22.95	88.4
Tādepallegūdem	02	16.81	81.53
Jalpāiguri	28	26.52	88.73
Chittaurgarh	24	24.89	74.62
Gangāwati	19	15.43	76.53
Khurja	36	28.25	77.86
Ponnāni	13	10.77	75.93
Barnāla	23	30.37	75.55
Badlapur	16	19.16	73.27
Soyībug	12	34.08	74.71
Roorkee	39	29.87	77.89
Bagaha	34	27.1	84.09
Hosūr	25	12.74	77.83
Chūru	24	28.3	74.97
Nagda	35	23.46	75.42
Kashipur	39	29.21	78.96
Ghazīpur	36	25.58	83.59
Begusarai	34	25.42	86.13
Dhaulpur	24	26.69	77.88
Mormugao	33	15.39	73.81
Ferozepore	23	30.93	74.61
Gondal	09	21.96	70.8
Seoni	35	22.09	79.55
Jagādhri	10	30.17	77.3
Miriālgūda	40	16.87	79.56
Udgīr	16	18.39	77.12
Jamālpur	34	25.31	86.49
Nandurbar	16	21.37	74.24
Itārsi	35	22.61	77.76
Vasco da Gama	33	15.4	73.82
Phagwāra	23	31.22	75.77
Airoli	16	19.15	73
Amreli	09	21.6	71.21
Shikohābād	36	27.11	78.59
Kāsganj	36	27.81	78.65
Sehore	35	23.2	77.08
Rānībennur	19	14.62	75.63
Jagtiāl	40	18.79	78.92
Bhadrakh	21	21.05	86.52
Būndi	24	25.44	75.64
Ooty	25	11.41	76.7
Mughal Sarāi	36	25.28	83.12
Shāmli	36	29.45	77.31
Hinganghāt	16	20.55	78.84
Villupuram	25	11.94	79.49
Amalner	16	21.04	75.06
Bagalkot	19	16.19	75.7
Tellicherry	13	11.75	75.49
Narasaraopet	02	16.23	80.05
Nāgaur	24	27.2	73.73
Nawāda	34	24.89	85.54
Jahānābād	34	25.21	84.99
Chālisgaon	16	20.46	75.02
Buxar	34	25.58	83.98
Aurangābād	34	24.75	84.37
Sāhibganj	38	25.24	87.63
Pandharpur	16	17.68	75.33
Hindaun	24	26.73	77.04
Khargone	35	21.82	75.61
Parli Vaijnāth	16	18.85	76.53
Kishanganj	34	26.1	87.96
Mainpuri	36	27.23	79.03
Khāmgaon	16	20.71	76.57
Negapatam	25	10.76	79.84
Chilakalūrupet	02	16.09	80.17
Gudiyatham	25	12.95	78.87
Makrāna	24	27.04	74.72
Bānswāra	24	23.54	74.44
Baraut	36	29.1	77.26
Closepet	19	12.72	77.28
Kalyani	28	22.98	88.48
Tādpatri	02	14.91	78.01
Kapūrthala	23	31.38	75.38
Dīsa	09	24.26	72.18
Ballālpur	16	19.85	79.35
Kohima	20	25.67	94.11
Betūl	35	21.9	77.9
Kāraikkudi	25	10.07	78.77
Balāngīr	21	20.7	83.49
Datia	35	25.67	78.46
Valparai	25	10.33	76.95
Kovilpatti	25	9.17	77.87
Vaniyambadi	25	12.68	78.62
Bhandāra	16	21.17	79.65
Roha	16	18.44	73.12
Muktsar	23	30.47	74.52
Luckeesarai	34	25.18	86.09
Bārmer	24	25.75	71.39
Murādnagar	36	28.78	77.5
Tinsukia	03	27.49	95.36
Shahdol	35	23.29	81.36
Manjeri	13	11.12	76.12
Mahobā	36	25.29	79.88
Contai	28	21.78	87.75
Sangrūr	23	30.25	75.84
Pollachi	25	10.66	77.01
Deoband	36	29.7	77.68
Neyyāttinkara	13	8.4	77.09
Tāndā	36	26.55	82.66
Bārān	24	25.1	76.52
Dhamtari	37	20.71	81.55
Tiruchengode	25	11.38	77.89
Chīrāla	02	15.82	80.35
Jharia	38	23.74	86.41
Akot	16	21.1	77.06
Rājpura	23	30.48	76.59
Madgaon	33	15.28	73.96
Sardārshahr	24	28.44	74.49
Mayiladuthurai	25	11.1	79.66
Kāmthi	16	21.22	79.2
Parādīp Garh	21	20.32	86.61
Paramagudi	25	9.55	78.59
Osmanabad	16	18.18	76.04
Aruppukkottai	25	9.51	78.1
Bāruni	34	25.48	85.97
Bijnor	36	29.37	78.14
Anakāpalle	02	17.69	83
Najībābād	36	29.61	78.34
Dohad	09	22.83	74.26
Rāmgarh	38	23.63	85.52
Kāvali	02	14.92	79.99
Fatehpur	24	27.99	74.96
Jangipur	28	24.47	88.08
Dhār	35	22.59	75.3
Hānsi	10	29.1	75.96
Kadiri	02	14.11	78.16
Dhorāji	09	21.73	70.45
Rāyachoti	02	14.06	78.75
Khambhāt	09	22.32	72.62
Nirmal	40	19.1	78.34
Emmiganūr	02	15.77	77.48
Jeypore	21	18.86	82.57
Kotkapura	23	30.58	74.83
Udhampur	12	32.92	75.14
Kairāna	36	29.4	77.21
Bālāghāt	35	21.82	80.19
Mānsa	23	29.99	75.4
Anantnag	12	33.73	75.15
Kāraikāl	22	10.92	79.83
Jharsuguda	21	21.86	84.01
Brājarājnagar	21	21.82	83.92
Kottagūdem	40	17.55	80.62
Nawābganj	36	26.93	81.2
Arakkonam	25	13.08	79.67
Koch Bihār	28	26.33	89.45
Dod Ballāpur	19	13.29	77.54
Bhadohi	36	25.4	82.57
Kātoya	28	23.65	88.13
Jamūī	34	24.93	86.23
Harihar	19	14.51	75.81
Mancherāl	40	18.87	79.43
Kadayanallur	25	9.07	77.34
Daltonganj	38	24.04	84.07
Farīdkot	23	30.67	74.76
Balrāmpur	36	27.43	82.19
Bāramūla	12	34.21	74.34
Dhuliān	28	24.68	87.95
Mawāna	36	29.1	77.92
Karur	25	10.96	78.08
Kundla	09	21.34	71.31
Manmād	16	20.25	74.44
Kannauj	36	27.06	79.92
Malaut	23	30.21	74.48
Nagīna	36	29.44	78.44
Badagara	13	11.6	75.58
Jagdalpur	37	19.08	82.02
Jumri Tilaiyā	38	24.43	85.53
Baj Baj	28	22.48	88.18
Konnagar	28	22.71	88.34
Ratnagiri	16	16.99	73.31
Hingoli	16	19.71	77.14
Bodināyakkanūr	25	10.01	77.35
Khadki	16	18.56	73.85
Dhrāngadhra	09	22.99	71.47
Pāloncha	40	17.6	80.71
Gūdūr	02	14.15	79.85
Ankleshwar	09	21.63	72.99
Tīkamgarh	35	24.74	78.83
Srivilliputhur	25	9.51	77.63
Sivakasi	25	9.45	77.8
Pilkhua	36	28.71	77.66
Ambājogāi	16	18.73	76.39
Bela	36	25.92	82
Bodhan	40	18.66	77.89
Rabkavi	19	16.48	75.11
Karauli	24	26.5	77.03
Savarkundla	09	21.34	71.3
Shāhābād	36	27.64	79.94
Chāndpur	36	29.13	78.27
Gokak	19	16.17	74.82
Sikandarābād	36	28.45	77.7
Virudunagar	25	9.59	77.96
Dausa	24	26.89	76.34
Valsād	09	20.61	72.93
Ambikāpur	37	23.12	83.2
Pālghar	16	19.7	72.77
Dharapuram	25	10.74	77.53
Chintāmani	19	13.4	78.05
Farīdpur	36	28.21	79.54
Pusad	16	19.91	77.58
Madhubani	34	26.35	86.07
Sirsilla	40	18.39	78.81
Vapi	09	20.37	72.9
Kāmāreddi	40	18.32	78.34
Bolpur	28	23.66	87.7
Rānāghāt	28	23.18	88.57
Fāzilka	23	30.4	74.03
Beypore	13	11.17	75.81
Dādri	36	28.55	77.55
Auraiya	36	26.47	79.51
Bāpatla	02	15.9	80.47
Payyannūr	13	12.09	75.2
Talipparamba	13	12.04	75.36
Tindivanam	25	12.23	79.66
Shirpur	16	21.35	74.88
Bāsoda	35	23.85	77.94
Jorhāt	03	26.76	94.2
Sindhnūr	19	15.77	76.76
Bargarh	21	21.33	83.62
Wāshīm	16	20.11	77.13
Visnagar	09	23.7	72.55
Palwancha	40	17.58	80.68
Keshod	09	21.3	70.25
Kānnangād	13	12.31	75.11
Bīsalpur	36	28.29	79.8
Tanuku	02	16.75	81.68
Attili	02	16.7	81.6
Bālotra	24	25.83	72.24
Pithampur	35	22.6	75.7
Munnar	13	10.09	77.06
Chamrajnagar	19	11.92	76.94
Pattukkottai	25	10.42	79.32
Jaisalmer	24	26.92	70.9
Arāria	34	26.15	87.51
Harda Khās	35	22.34	77.1
Sangamner	16	19.57	74.21
Jaorā	35	23.64	75.13
Buldāna	16	20.53	76.18
Mettupalayam	25	11.3	76.93
Anjār	09	23.11	70.03
Bellampalli	40	19.06	79.49
Channapatna	19	12.65	77.21
Ratangarh	24	28.08	74.62
Krishnagiri	25	12.52	78.21
Rishīkesh	39	30.11	78.29
Goyerkāta	28	26.7	89.03
Chāībāsa	38	22.55	85.8
Mandamarri	40	18.97	79.47
Palani	25	10.45	77.52
Nārnaul	10	28.04	76.11
Dharmapuri	25	12.13	78.16
Fatehābād	10	29.52	75.46
Palāsa	02	18.77	84.41
Basavakalyān	19	17.87	76.95
Chingleput	25	12.69	79.98
Chopda	16	21.25	75.3
Panaji	33	15.5	73.83
Thenkasi	25	8.96	77.32
Yādgīr	19	16.77	77.14
Gangārāmpur	28	25.4	88.53
Ramanathapuram	25	9.37	78.83
Jagraon	23	30.79	75.47
Alīpur Duār	28	26.48	89.52
Kopargaon	16	19.88	74.48
Bongaigaon	03	26.48	90.56
Malkāpur	16	20.89	76.2
Kāranja	16	20.48	77.49
Khatauli	36	29.28	77.73
Ashoknagar	35	24.58	77.73
Siuri	28	23.91	87.53
Nābha	23	30.38	76.15
Siddipet	40	18.1	78.85
Bhawānipatna	21	19.91	83.17
Khopoli	16	18.79	73.35
Karwar	19	14.81	74.13
Kāyankulam	13	9.18	76.5
Chinnachowk	02	14.48	78.84
Bishnupur	28	23.07	87.32
Mārkāpur	02	15.74	79.27
Basmat	16	19.33	77.16
Baheri	36	28.77	79.5
Kunnamkulam	13	10.65	76.07
Rāghogarh	35	24.44	77.2
Gopālganj	34	26.47	84.44
Tura	18	25.51	90.2
Rājsamand	24	25.07	73.88
Tāndūr	40	17.25	77.58
Kalamassery	13	10.06	76.33
Sūratgarh	24	29.32	73.9
Mannargudi	25	10.67	79.45
Sopur	12	34.29	74.47
Arni	25	12.67	79.29
Kannur	13	11.87	75.36
Dhuburi	03	26.02	89.99
Puliyangudi	25	9.17	77.4
Sheopur	35	25.66	76.7
Renukūt	36	24.22	83.04
Dhenkānāl	21	20.66	85.6
Dabwāli	10	29.95	74.74
Sibsāgar	03	26.98	94.64
Malappuram	13	11.04	76.08
Rāth	36	25.59	79.57
Jamkhandi	19	16.5	75.29
Sirsi	19	14.62	74.84
Vriddhāchalam	25	11.52	79.32
Vinukonda	02	16.05	79.74
Tiptūr	19	13.26	76.48
Sahaswān	36	28.07	78.75
Koppal	19	15.35	76.15
Sirhind	23	30.64	76.38
Dabra	35	25.89	78.33
Cumbum	25	9.74	77.28
Arāmbāgh	28	22.88	87.78
Himatnagar	09	23.6	72.97
Lādnūn	24	27.65	74.4
Nipāni	16	16.4	74.38
Borsad	09	22.41	72.9
Koratla	40	18.82	78.71
Kīratpur	36	29.51	78.21
Vrindāvan	36	27.58	77.7
Hāveri	19	14.79	75.4
Supaul	34	26.12	86.6
Gīrīdīh	38	24.19	86.31
Bangaon	34	25.87	86.51
Rāyadrug	02	14.7	76.85
North Lakhimpur	03	27.24	94.1
Tohāna	10	29.71	75.9
Gangoh	36	29.78	77.26
Kottayam	13	9.59	76.52
Mangalagiri	02	16.43	80.57
Narasapur	02	16.43	81.7
Sangāreddi	40	17.62	78.09
Kodār	40	17	79.97
Ullal	19	12.81	74.86
Māngrol	09	21.12	70.11
Gola Gokarannāth	36	28.08	80.47
Modāsa	09	23.46	73.3
Tezpur	03	26.63	92.8
Thiruvarur	25	10.77	79.64
Attur	25	11.59	78.6
Chidambaram	25	11.4	79.69
Tarn Tāran	23	31.45	74.93
Udumalaippettai	25	10.59	77.25
Lonavla	16	18.75	73.41
Shāhāda	16	21.55	74.47
Nawalgarh	24	27.85	75.27
Nedumangād	13	8.6	77
Nīmbāhera	24	24.62	74.68
Kadi	09	23.3	72.33
Sīra	19	13.74	76.9
Chik Ballāpur	19	13.44	77.73
Bārdoli	09	21.12	73.11
Jhārgrām	28	22.45	86.99
Samāstipur	34	25.86	85.78
Gobichettipalayam	25	11.45	77.44
Hasanpur	36	28.72	78.28
Jahāngīrābād	36	28.41	78.11
Sherkot	36	29.33	78.57
Kātrās	38	23.8	86.3
Pālakollu	02	16.52	81.73
Wani	16	20.06	78.95
Naksalbāri	28	26.68	88.22
Tiruvalla	13	9.38	76.57
Ponnūru	02	16.07	80.55
Diphu	03	25.84	93.43
Sītāmarhi	34	26.59	85.49
Chhibrāmau	36	27.15	79.5
Tilhar	36	27.96	79.74
Ilkal	19	15.96	76.11
Bada Barabīl	21	22.11	85.39
Mettur	25	11.79	77.8
Kuchāman	24	27.15	74.86
Panruti	25	11.78	79.55
Una	09	20.82	71.04
Ponnur	02	16.07	80.55
Kollegāl	19	12.15	77.11
Shegaon	16	20.79	76.7
Upleta	09	21.74	70.28
Ujhāni	36	28	79.01
Bankra	28	22.6	88.28
Dabhoi	09	22.18	73.43
Bāri	24	26.65	77.62
Obra	36	24.42	82.99
Gohāna	10	29.14	76.7
Jatani	21	20.16	85.71
Nāmakkal	25	11.22	78.17
Gadwāl	40	16.24	77.8
Pālitāna	09	21.53	71.82
Nokha	24	27.56	73.47
Lāharpur	36	27.71	80.9
Narwāna	10	29.6	76.12
Islāmpur	28	26.27	88.19
Karād	16	17.29	74.18
Jālaun	36	26.15	79.34
Karīmganj	03	24.87	92.36
Mokameh	34	25.4	85.92
Etāwa	35	24.18	78.2
Wanparti	40	16.37	78.07
Sāmalkot	02	17.06	82.18
Anjangaon	16	21.17	77.31
Dholka	09	22.73	72.44
Tirur	13	10.91	75.92
Kāndi	28	23.96	88.04
Ghātāl	28	22.66	87.73
Unjha	09	23.8	72.39
Sendhwa	35	21.69	75.1
Tiruttangal	25	9.48	77.83
Siddhapur	09	23.92	72.37
Dhūri	23	30.37	75.87
Sidhi	35	24.4	81.88
Wokha	20	26.1	94.26
Kālna	28	23.22	88.36
Bārāmati	16	18.15	74.58
Kandukūr	02	15.22	79.9
Sunām	23	30.13	75.8
Gaddi Annaram	40	17.37	78.52
Sattenapalle	02	16.39	80.15
Hiriyūr	19	13.94	76.62
Challakere	19	14.32	76.65
Rampur Hat	28	24.18	87.78
Masaurhi Buzurg	34	25.35	85.03
Nūzvīd	02	16.79	80.85
Shājāpur	35	23.43	76.28
Puttūr	19	12.76	75.2
Kāsaragod	13	12.5	74.99
Ajodhya	36	26.8	82.2
Mubārakpur	36	26.09	83.29
Phaltan	16	17.99	74.43
Sandīla	36	27.07	80.51
Sāgar	19	14.16	75.03
Lohārdagā	38	23.43	84.68
Deolāli	16	19.94	73.83
Shāhābād	19	17.13	76.94
Bobbili	02	18.57	83.36
Chikhli	16	20.35	76.26
Konch	36	25.99	79.15
Lunglei	31	22.89	92.74
Pithāpuram	02	17.12	82.25
Amalāpuram	02	16.58	82.01
Tuni	02	17.36	82.55
Sihor	09	21.71	71.96
Dīglūr	16	18.55	77.58
Barbil	21	22.1	85.38
Biswān	36	27.5	81
Kosi	36	27.79	77.44
Ropar	23	30.97	76.53
Dandeli	19	15.27	74.62
Pārvatipuram	02	18.78	83.43
Arcot	25	12.91	79.32
Jhālāwār	24	24.6	76.16
Petlād	09	22.48	72.8
Umred	16	20.85	79.32
Bhātāpāra	37	21.74	81.95
Kāliyāganj	28	25.63	88.33
Nasīrābād	24	26.3	74.73
Idappadi	25	11.59	77.84
Gohadi	35	26.43	78.44
Khagaul	34	25.58	85.05
Chiplūn	16	17.53	73.51
Changanācheri	13	9.44	76.54
Rāmnagar	39	29.39	79.13
Sillod	16	20.3	75.65
Mācherla	02	16.48	79.44
Tūndla	36	27.21	78.24
Mannārakkāt	13	10.99	76.46
Ottappālam	13	10.77	76.38
Goālpāra	03	26.18	90.63
Kānkānhalli	19	12.55	77.42
Madhupur	38	24.27	86.64
Madhipura	34	25.92	86.79
Charkhi Dādri	10	28.59	76.27
Dumraon	34	25.55	84.15
Mahāsamund	37	21.11	82.09
Gajraula	36	28.85	78.24
Ābu Road	24	24.48	72.78
Nanjangūd	19	12.12	76.68
Sālūr	02	18.52	83.21
Bhongīr	40	17.52	78.89
Aonla	36	28.27	79.17
#IQ
Baghdad	07	33.34	44.4
Basrah	02	30.51	47.78
Al Mawşil al Jadīdah	15	36.33	43.11
Al Başrah al Qadīmah	02	30.5	47.82
Mosul	15	36.34	43.12
Erbil	11	36.18	44.01
Abū Ghurayb	07	33.31	44.18
As Sulaymānīyah	05	35.56	45.43
Kirkuk	13	35.47	44.39
Najaf	17	32.03	44.35
Karbala	12	32.62	44.02
Nasiriyah	09	31.06	46.26
Al ‘Amārah	14	31.84	47.14
Ad Dīwānīyah	04	31.99	44.93
Al Kūt	16	32.51	45.82
Al Ḩillah	06	32.46	44.42
Dihok	08	36.87	42.99
Ramadi	01	33.42	43.31
Al Fallūjah	01	33.35	43.79
Sāmarrā’	18	34.2	43.89
As Samawah	03	31.33	45.29
Baqubah	10	33.75	44.61
Sīnah	08	36.81	43.04
Soran	11	36.65	44.54
Az Zubayr	02	30.39	47.7
Kufa	17	32.05	44.44
Umm Qaşr	02	30.04	47.92
Al Fāw	02	29.97	48.47
Zaxo	08	37.15	42.69
Al Hārithah	02	30.58	47.76
Ash Shaţrah	09	31.41	46.17
Al Ḩayy	16	32.17	46.04
Jamjamāl	05	35.53	44.83
Khāliş	10	33.81	44.53
Tozkhurmato	18	34.89	44.63
Ash Shāmīyah	04	31.96	44.6
Al Hindīyah	12	32.55	44.23
Ḩalabjah	05	35.18	45.99
Al Miqdādīyah	10	33.98	44.94
Al-Hamdaniya	15	36.27	43.38
#IR
Tehran	26	35.69	51.42
Mashhad	42	36.32	59.57
Isfahan	28	32.65	51.67
Karaj	44	35.83	50.99
Tabriz	33	38.08	46.29
Shiraz	07	29.61	52.53
Qom	39	34.64	50.88
Ahvaz	15	31.32	48.68
Pasragad Branch	09	34.78	48.47
Kahrīz	13	34.38	47.06
Kermanshah	13	34.31	47.07
Rasht	08	37.28	49.59
Kerman	29	30.28	57.08
Orūmīyeh	01	37.55	45.08
Zahedan	04	29.5	60.86
Hamadān	09	34.8	48.51
Āzādshahr	09	34.79	48.57
Arāk	34	34.09	49.7
Yazd	40	31.9	54.37
Ardabīl	32	38.25	48.29
Abadan	15	30.34	48.3
Zanjān	36	36.68	48.5
Bandar Abbas	11	27.19	56.28
Sanandaj	16	35.31	47
Qazvin	38	36.27	50
Khorramshahr	15	30.44	48.18
Khorramabad	23	33.49	48.36
Khomeynī Shahr	28	32.69	51.54
Sari	35	36.56	53.06
Borūjerd	23	33.9	48.75
Qarchak	26	35.43	51.58
Gorgān	37	36.84	54.44
Sabzevar	42	36.21	57.68
Najafābād	28	32.63	51.37
Neyshābūr	42	36.21	58.8
Naz̧arābād	44	35.95	50.61
Būkān	01	36.52	46.21
Sirjan	29	29.45	55.68
Bābol	35	36.55	52.68
Āmol	35	36.47	52.35
Bīrjand	41	32.87	59.22
Bojnūrd	43	37.47	57.33
Varāmīn	26	35.32	51.65
Malāyer	09	34.3	48.82
Sāveh	34	35.02	50.36
Khowy	01	38.55	44.95
Bushehr	22	28.97	50.84
Mahābād	01	36.76	45.72
Saqqez	16	36.25	46.27
Marvdasht	07	29.87	52.8
Rafsanjān	29	30.41	55.99
Īlām	10	33.64	46.42
Mīāndoāb	01	36.97	46.11
Shahrud	25	36.42	54.98
Gonbad-e Kāvūs	37	37.25	55.17
Iranshahr	04	27.2	60.68
Shahr-e Kord	03	32.33	50.86
Torbat-e Ḩeydarīyeh	42	35.27	59.22
Semnan	25	35.58	53.39
Marand	33	38.43	45.77
Zābol	04	31.03	61.49
Qūchān	42	37.11	58.51
Masjed Soleymān	15	31.94	49.3
Bandar-e Anzalī	08	37.47	49.46
Bāneh	16	36	45.89
Pārsābād	32	39.65	47.92
Kūhdasht	23	33.53	47.61
Bam	29	29.11	58.36
Akbarābād	07	29.25	52.78
Fasā	07	28.94	53.65
Yasuj	05	30.67	51.59
Kāshmar	42	35.24	58.47
Dogonbadan	05	30.36	50.8
Kāzerūn	07	29.62	51.65
Ahar	33	38.48	47.07
Behshahr	35	36.69	53.55
Marīvān	16	35.52	46.18
Alīgūdarz	23	33.4	49.69
Alvand	38	36.19	50.06
Qorveh	16	35.17	47.81
Borāzjān	22	29.27	51.22
Shīrvān	43	37.4	57.93
Salmās	01	38.2	44.77
Bonāb	33	37.34	46.06
Shahre Jadide Andisheh	26	35.68	51.02
Behbahān	15	30.6	50.24
Shūshtar	15	32.05	48.85
Khomeyn	34	33.64	50.08
Nahāvand	09	34.19	48.37
Alvand	36	36.32	49.17
Nūrābād	23	34.07	47.97
Naqadeh	01	36.96	45.39
Tākestān	38	36.07	49.7
Mīnāb	11	27.13	57.09
Abhar	36	36.15	49.22
Dehdasht	05	30.79	50.56
Chālūs	35	36.66	51.42
Khāsh	04	28.22	61.22
Langarūd	08	37.2	50.15
Dāmghān	25	36.17	54.34
Fīrūzābād	07	28.84	52.57
Nūrābād	07	30.11	51.52
Dārāb	07	28.75	54.54
Robāţ Karīm	26	35.48	51.08
Piranshahr	01	36.7	45.14
Kāmyārān	16	34.8	46.94
Esfarāyen	43	37.08	57.51
Asadābād	09	34.78	48.12
Zarand	29	30.81	56.56
Torbat-e Jām	42	35.24	60.62
Shahrīār	26	35.66	51.06
Ardakān	40	32.31	54.02
Harsīn	13	34.27	47.59
Ābādeh	07	31.16	52.65
Malārd	26	35.67	50.98
Ābyek	34	36.07	50.55
Bījār	16	35.87	47.61
Pīshvā	26	35.31	51.73
Kangāvar	13	34.5	47.97
Bandar-e Genāveh	22	29.58	50.52
Borūjen	03	31.97	51.29
Shahr-e Bābak	29	30.12	55.12
Shūsh	15	32.19	48.24
Meybod	40	32.25	54.02
Sarpol-e Z̄ahāb	13	34.46	45.86
Takāb	01	36.4	47.11
Khalkhāl	32	37.62	48.53
Oshnavīyeh	01	37.04	45.1
Khorramdarreh	36	36.21	49.2
#IS
Reykjavík	39	64.14	-21.9
#IT
Rome	07	41.89	12.51
Milan	09	45.46	9.19
Naples	04	40.85	14.27
Turin	12	45.07	7.69
Palermo	15	38.13	13.34
Genoa	08	44.4	8.94
Bologna	05	44.49	11.34
Florence	16	43.78	11.25
Catania	15	37.49	15.07
Bari	13	41.12	16.87
Messina	15	38.19	15.55
Verona	20	45.43	10.98
Padova	20	45.41	11.89
Trieste	06	45.65	13.78
Brescia	09	45.54	10.21
Prato	16	43.88	11.1
Taranto	13	40.46	17.25
Reggio Calabria	03	38.11	15.66
Modena	05	44.65	10.93
Livorno	16	43.54	10.33
Cagliari	14	39.23	9.12
Mestre	20	45.49	12.25
Parma	05	44.8	10.33
Foggia	13	41.46	15.55
Reggio nell'Emilia	05	44.7	10.63
Acilia-Castel Fusano-Ostia Antica	07	41.76	12.33
Salerno	04	40.68	14.79
Perugia	18	43.11	12.39
Monza	09	45.58	9.27
Rimini	05	44.06	12.57
Pescara	01	42.46	14.2
Bergamo	09	45.7	9.67
Vicenza	20	45.55	11.55
Bolzano	17	46.49	11.34
Andria	13	41.23	16.3
Udine	06	46.07	13.24
Siracusa	15	37.08	15.29
Terni	18	42.56	12.64
Forlì	05	44.22	12.04
Novara	12	45.45	8.62
Barletta	13	41.31	16.28
Piacenza	05	45.05	9.69
Ferrara	05	44.84	11.62
Sassari	14	40.73	8.56
Ancona	10	43.59	13.5
La Spezia	08	44.1	9.82
Torre del Greco	04	40.79	14.37
Como	09	45.81	9.08
Lucca	16	43.84	10.5
Ravenna	05	44.41	12.2
Lecce	13	40.35	18.17
Trento	17	46.07	11.12
Giugliano in Campania	04	40.93	14.2
Busto Arsizio	09	45.61	8.85
Lido di Ostia	07	41.73	12.28
Cesena	05	44.14	12.24
Catanzaro	03	38.88	16.6
Brindisi	13	40.63	17.94
Marsala	15	37.8	12.44
Treviso	20	45.67	12.24
Pesaro	10	43.91	12.92
Pisa	16	43.71	10.4
Varese	09	45.82	8.83
Sesto San Giovanni	09	45.53	9.23
Arezzo	16	43.46	11.88
Latina	07	41.47	12.9
Gela	15	37.07	14.24
Pistoia	16	43.93	10.92
Caserta	04	41.07	14.33
Fuorigrotta	04	40.83	14.2
Cinisello Balsamo	09	45.56	9.21
Lamezia Terme	03	38.96	16.31
San Carlo All'Arena	04	40.87	14.26
Altamura	13	40.83	16.55
Arenella	04	40.86	14.22
Guidonia Montecelio	07	41.99	12.72
Quartu Sant'Elena	14	39.23	9.25
Pavia	09	45.19	9.16
Castellammare di Stabia	04	40.7	14.49
Massa	16	44.04	10.14
Alessandria	12	44.91	8.61
Cosenza	03	39.3	16.25
Afragola	04	40.92	14.31
Ragusa	15	36.93	14.72
Asti	12	44.9	8.21
Grosseto	16	42.76	11.11
Cremona	09	45.13	10.02
Molfetta	13	41.2	16.6
Trapani	15	38.02	12.54
Carrara	16	44.08	10.1
Casoria	04	40.91	14.29
Savona	08	44.31	8.48
Vigevano	09	45.31	8.85
Pianura	04	40.86	14.17
Legnano	09	45.6	8.92
Caltanissetta	15	37.49	14.06
Potenza	02	40.64	15.81
Portici	04	40.82	14.34
Matera	02	40.67	16.6
San Severo	13	41.69	15.38
Cerignola	13	41.27	15.9
Trani	13	41.28	16.41
Bisceglie	13	41.24	16.5
Acerra	04	40.94	14.37
Ercolano	04	40.81	14.35
Carpi Centro	05	44.78	10.88
Imola	05	44.36	11.71
Bagheria	15	38.08	13.51
Manfredonia	13	41.63	15.92
Aversa	04	40.97	14.21
Ponticelli	04	40.85	14.33
Bitonto	13	41.11	16.69
Venice	20	45.44	12.33
Vittoria	15	36.95	14.53
Gallarate	09	45.66	8.79
#JM
Kingston	17	18	-76.79
New Kingston	08	18.01	-76.78
Spanish Town	10	17.99	-76.96
Portmore	10	17.95	-76.88
Montego Bay	12	18.47	-77.92
#JO
Amman	16	31.96	35.95
Zarqa	17	32.07	36.09
Irbid	18	32.56	35.85
Russeifa	17	32.02	36.05
Wādī as Sīr	16	31.95	35.82
‘Ajlūn	20	32.33	35.75
Aqaba	21	29.53	35.01
Rukban	15	33.31	38.7
Mādabā	23	31.72	35.79
As Salţ	02	32.04	35.73
Ar Ramthā	18	32.56	36.01
Mafraq	15	32.34	36.21
Ma'an	19	30.2	35.73
#JP
Tokyo	40	35.69	139.69
Yokohama	19	35.43	139.65
Osaka	32	34.69	135.5
Nagoya	01	35.18	136.91
Sapporo	12	43.07	141.35
Kobe	13	34.69	135.18
Kyoto	22	35.02	135.75
Fukuoka	07	33.6	130.42
Kawasaki	19	35.52	139.72
Saitama	34	35.91	139.66
Hiroshima	11	34.4	132.45
Yono	34	35.88	139.63
Sendai	24	38.27	140.87
Kitakyushu	07	33.85	130.85
Chiba	04	35.6	140.12
Sakai	32	34.58	135.47
Shizuoka	37	34.98	138.38
Kumamoto	21	32.81	130.69
Okayama	31	34.65	133.93
Hamamatsu	37	34.7	137.73
Hachiōji	40	35.66	139.32
Honchō	04	35.7	139.99
Kagoshima	18	31.57	130.55
Niigata	29	37.89	139.01
Himeji	13	34.82	134.7
Matsudo	04	35.78	139.9
Nishinomiya-hama	13	34.72	135.33
Kawaguchi	34	35.81	139.71
Kanazawa	15	36.6	136.62
Utsunomiya	38	36.57	139.88
Ōita	30	33.23	131.6
Matsuyama	05	33.84	132.77
Amagasaki	13	34.72	135.42
Kurashiki	31	34.58	133.77
Yokosuka	19	35.28	139.67
Nagasaki	27	32.75	129.88
Hirakata	32	34.81	135.65
Machida	40	35.54	139.45
Gifu-shi	09	35.42	136.76
Fujisawa	19	35.35	139.48
Toyonaka	32	34.78	135.47
Fukuyama	11	34.48	133.37
Toyohashi	01	34.77	137.38
Minato	43	34.22	135.15
Nara-shi	28	34.69	135.8
Toyota	01	35.08	137.15
Nagano	26	36.65	138.18
Iwaki	08	37.05	140.88
Asahikawa	12	43.77	142.36
Takatsuki	32	34.85	135.62
Okazaki	01	34.95	137.17
Suita	32	34.76	135.52
Wakayama	43	34.23	135.17
Kōriyama	08	37.4	140.38
Kashiwa	04	35.86	139.98
Tokorozawa	34	35.8	139.47
Kawagoe	34	35.91	139.49
Kochi	20	33.55	133.53
Takamatsu	17	34.33	134.05
Toyama	42	36.7	137.22
Akita	02	39.72	140.12
Koshigaya	34	35.89	139.79
Miyazaki	25	31.92	131.42
Naha	47	26.22	127.68
Kasugai	01	35.25	136.97
Aomori	03	40.82	140.73
Ōtsu	35	35	135.87
Akashi	13	34.66	135.01
Yokkaichi	23	34.97	136.62
Morioka	16	39.7	141.15
Fukushima	08	37.75	140.47
Ichihara	04	35.52	140.08
Maebashi	10	36.4	139.08
Ichinomiya	01	35.3	136.8
Hakodate	12	41.78	140.74
Ibaraki	32	34.82	135.57
Yao	32	34.62	135.6
Kakogawachō-honmachi	13	34.77	134.83
Tokushima	39	34.07	134.57
Hiratsuka	19	35.33	139.34
Yamagata	44	38.23	140.37
Fukui-shi	06	36.06	136.22
Mito	14	36.35	140.45
Shimonoseki	45	33.95	130.95
Takasaki	10	36.33	139.02
Fuji	37	35.17	138.68
Hachinohe	03	40.5	141.5
Neyagawa	32	34.77	135.63
Kurume	07	33.32	130.52
Sasebo	27	33.17	129.73
Chigasaki	19	35.34	139.4
Sōka	34	35.84	139.8
Atsugi	19	35.44	139.37
Minamirinkan	19	35.5	139.44
Takarazuka	13	34.8	135.36
Ageoshimo	34	35.97	139.61
Chōfu	40	35.66	139.55
Matsumoto	26	36.23	137.97
Kasukabe	34	35.98	139.75
Kishiwada	32	34.47	135.37
Numazu	37	35.1	138.87
Jōetsu	29	37.15	138.24
Odawara	19	35.26	139.16
Kure	11	34.23	132.57
Nagaoka	29	37.45	138.85
Nishi-Tokyo-shi	40	35.73	139.54
Itami	13	34.78	135.4
Uji	22	34.89	135.8
Suzuka	23	34.88	136.58
Kōfu	46	35.67	138.57
Izumi	32	34.48	135.43
Hitachi	14	36.6	140.65
Kushiro	12	42.98	144.37
Sakura	04	35.72	140.23
Kamirenjaku	40	35.69	139.55
Anjō	01	34.96	137.08
Tsukuba	14	36.2	140.1
Hirosaki	03	40.59	140.47
Tomakomai	12	42.64	141.6
Hadano	19	35.37	139.22
Obihiro	12	42.92	143.2
Ube	45	33.94	131.25
Hino	40	35.67	139.4
Takaoka	42	36.75	137.02
Kamakura	19	35.31	139.55
Saga	33	33.23	130.3
Tsu	23	34.73	136.52
Sayama	34	35.85	139.41
Kawanishi	13	34.82	135.42
Oyama	38	36.3	139.8
Ashikaga	38	36.33	139.45
Matsue	36	35.48	133.05
Hitachi-Naka	14	36.4	140.53
Nagareyama	04	35.86	139.9
Katsuta	14	36.38	140.53
Kumagaya	34	36.13	139.39
Tottori	41	35.5	134.23
Ōta	10	36.3	139.37
Komaki	01	35.28	136.92
Ōgaki	09	35.35	136.62
Higashimurayama	40	35.75	139.47
Ōme	40	35.78	139.24
Moriguchi	32	34.73	135.57
Yamaguchi	45	34.18	131.47
Otaru	12	43.19	141
Urayasu	40	35.67	139.89
Yonago	41	35.43	133.33
Kuwana	23	35.05	136.67
Kariya	01	34.98	136.98
Musashino	40	35.71	139.56
Zama	19	35.49	139.39
Seto	01	35.23	137.1
Ebetsu	12	43.11	141.55
Tondabayashichō	32	34.5	135.6
Fujieda	37	34.87	138.27
Sandachō	13	34.88	135.23
Kakamigahara	09	35.42	136.87
Ōmuta	07	33.03	130.45
Abiko	04	35.87	140.02
Kadoma	32	34.74	135.57
Miyakonojō	25	31.73	131.07
Matsubara	32	34.57	135.55
Isesaki	10	36.32	139.2
Daitōchō	32	34.71	135.62
Mino	32	34.83	135.47
Asaka	34	35.8	139.6
Kusatsu	35	35.02	135.97
Ueda	26	36.4	138.28
Okinawa	47	26.34	127.8
Beppu	30	33.28	131.5
Kashihara-shi	28	34.51	135.79
Niihama	05	33.96	133.31
Kisarazu	04	35.38	139.93
Nobeoka	25	32.58	131.67
Fujinomiya	37	35.22	138.62
Noda	04	35.95	139.87
Yaizu	37	34.87	138.32
Toyokawa	01	34.82	137.4
Shimotoda	34	35.82	139.69
Kokubunji	40	35.7	139.48
Ikoma	28	34.68	135.7
Ishinomaki	24	38.42	141.3
Hōfu	45	34.05	131.57
Handa	01	34.88	136.93
Mishima	37	35.12	138.92
Kitami	12	43.8	143.89
Hikone	35	35.25	136.25
Kiryū	10	36.4	139.33
Komatsu	15	36.4	136.45
Iwatsuki	34	35.96	139.7
Tajimi	09	35.32	137.13
Iida	26	35.52	137.82
Fukayachō	34	36.2	139.28
Honmachi	21	32.5	130.6
Iwakuni	45	34.16	132.22
Isehara	19	35.4	139.31
Nishio	01	34.87	137.05
Inazawa	01	35.25	136.78
Tokuyama	45	34.05	131.82
Narita	04	35.78	140.32
Izumisano	32	34.42	135.32
Sakata	44	38.92	139.85
Kōnan	01	35.33	136.87
Chikushino-shi	07	33.5	130.52
Tsuruoka	44	38.72	139.82
Ikeda	32	34.82	135.43
Isahaya	27	32.84	130.04
Mobara	04	35.43	140.3
Ise	23	34.48	136.7
Kameoka	22	35	135.58
Sakado	34	35.96	139.39
Muroran	12	42.32	140.99
Ōnojō	07	33.54	130.48
Kanuma	38	36.55	139.73
Yonezawa	44	37.91	140.12
Kitakami	16	39.28	141.12
Chitose	12	42.82	141.65
Kaizuka	32	34.45	135.35
Maizuru	22	35.45	135.33
Kimitsu	04	35.35	139.87
Ginowan	47	26.26	127.76
Onomichi	11	34.42	133.2
Ōmura	27	32.92	129.95
Tsuyama	31	35.05	134
Izumo	36	35.37	132.77
Ashiya	13	34.73	135.3
Iwata	37	34.7	137.85
Kōnosu	34	36.07	139.52
Nabari	23	34.62	136.08
Yotsukaidō	04	35.65	140.17
Hamakita	37	34.8	137.78
Gyōda	34	36.14	139.46
Hannō	34	35.85	139.32
Kashiwazaki	29	37.37	138.55
Ryūgasaki	14	35.9	140.18
Iwamizawa	12	43.2	141.76
Kakegawa	37	34.77	138.02
Gotenba	37	35.32	138.94
Yachimata	04	35.65	140.32
Katori-shi	04	35.9	140.5
Kamigyō-ku	22	35.03	135.76
Sanjō	29	37.62	138.95
Sano	38	36.32	139.58
Kanoya	18	31.38	130.85
Tochigi	38	36.38	139.73
Tanashichō	40	35.73	139.54
Marugame	17	34.28	133.78
Yashio	34	35.82	139.84
Tatebayashi	10	36.25	139.53
Shibata	29	37.95	139.33
Gamagōri	01	34.83	137.23
Izumiōtsu	32	34.5	135.4
Toride	14	35.9	140.08
Mihara	11	34.4	133.08
Ushiku	14	35.97	140.13
Kashihara	32	34.58	135.62
Karatsu	33	33.44	129.97
Iizuka	07	33.64	130.69
Ōbu	01	35.02	136.95
Wako	34	35.79	139.62
Hatsukaichi	11	34.35	132.33
Tsurusaki	30	33.25	131.69
Furukawa	24	38.57	140.96
Shimada	37	34.82	138.18
Takefu	06	35.9	136.17
Okegawa	34	36	139.56
Miki	13	34.8	134.98
Inuyama	01	35.38	136.94
Kukichūō	34	36.07	139.67
Satsumasendai	18	31.82	130.3
Hanamaki	16	39.38	141.12
Yawata	22	34.87	135.7
Itō	37	34.97	139.08
Kazo	34	36.12	139.6
Yukuhashi	07	33.73	130.98
Tenri	28	34.58	135.83
Dazaifu	07	33.51	130.52
Maebaru-chūō	07	33.56	130.2
Tanabe	43	33.73	135.37
Ōmihachiman	35	35.13	136.1
Saku	26	36.22	138.48
Hekinan	01	34.88	136.98
Sukagawa	08	37.28	140.38
Fukuchiyama	22	35.3	135.12
Moriyama	35	35.07	135.98
Tsuruga	06	35.65	136.06
Matsutō	15	36.52	136.57
Tamano	31	34.52	133.95
Tsushima	01	35.17	136.72
Nakatsu	30	33.6	131.19
Shiojiri	26	36.1	137.97
Chiryū	01	35	137.03
Takayama	09	36.13	137.25
Tōgane	04	35.55	140.37
Sabae	06	35.95	136.18
Niitsu-honchō	29	37.8	139.12
Tanabe	22	34.82	135.77
Kashima-shi	14	35.97	140.64
Mooka	38	36.43	140.02
Shiki	34	35.83	139.58
Tendō	44	38.35	140.37
Gushikawa	47	26.36	127.87
Hasuda	34	35.97	139.65
Ōdate	02	40.27	140.56
Imaichi	38	36.72	139.68
Narutochō-mitsuishi	39	34.2	134.61
Shimodate	14	36.3	139.98
Tosu	33	33.37	130.52
Fujioka	10	36.25	139.07
Fukuroi	37	34.75	137.92
Ichinoseki	16	38.92	141.13
Sakurai	28	34.5	135.85
Kitahiroshima	12	42.98	141.57
Fussa	40	35.74	139.32
Ina	26	35.83	137.95
Nagahama	35	35.38	136.27
Honjō	34	36.24	139.19
Ueno-ebisumachi	23	34.76	136.13
Hita	30	33.32	130.94
Toki	09	35.35	137.18
Mizusawa	16	39.13	141.13
Kuroiso	38	36.97	140.05
Takaishi	32	34.52	135.43
Yoshikawa	34	35.89	139.84
Zushi	19	35.29	139.58
Koga	07	33.73	130.47
Nago	47	26.62	127.99
Shiogama	24	38.32	141.03
Uwajima	05	33.22	132.56
Ōtawara	38	36.87	140.03
Saijō	05	33.92	133.18
Hanyū	34	36.17	139.53
Chichibu	34	35.99	139.08
Kasaoka	31	34.51	133.5
Koga	14	36.18	139.72
Imarichō-kō	33	33.27	129.88
Kokubu-matsuki	18	31.73	130.77
Sōja	31	34.68	133.75
Ishikari	12	43.24	141.35
Itoman	47	26.13	127.67
Hashimoto	43	34.32	135.62
Sakaidechō	17	34.32	133.84
Nōgata	07	33.74	130.72
Chino	26	35.99	138.15
Moriya	14	35.93	140
Tomigusuku	47	26.19	127.68
Iwade	43	34.25	135.32
Anan	39	33.92	134.65
Nanto-shi	42	36.57	136.91
Shiroi	04	35.8	140.07
Satte	34	36.07	139.73
Nakatsugawa	09	35.48	137.5
Suwa	26	36.04	138.11
Himimachi	42	36.86	136.99
Okaya	26	36.06	138.05
Suzaka	26	36.65	138.32
Ōami	04	35.52	140.32
Mukō	22	34.97	135.7
Hatogaya-honchō	34	35.83	139.74
Kudamatsu	45	34	131.87
Kamifukuoka	34	35.87	139.51
Ishioka	14	36.18	140.27
Kariya	13	34.75	134.39
Miyako	16	39.65	141.94
Futtsu	04	35.31	139.82
Tagawa	07	33.63	130.8
Yūki	14	36.3	139.88
Minokamo	09	35.48	137.02
Miura	19	35.14	139.62
Noshiro	02	40.21	140.03
Shiraoka	34	36.02	139.66
Kitaibaraki	14	36.79	140.75
Fuchūchō	11	34.57	133.24
Ōi	34	35.85	139.52
Ono	13	34.85	134.93
Tateyama	04	34.98	139.87
Arashiyama	22	35.01	135.68
#KE
Nairobi	05	-1.28	36.82
Mombasa	37	-4.05	39.66
Nakuru	39	-0.31	36.07
Eldoret	52	0.52	35.27
Kisumu	26	-0.1	34.76
Thika	05	-1.03	37.07
Malindi	23	-3.22	40.12
Kitale	50	1.02	35.01
Garissa	16	-0.45	39.65
Kakamega	20	0.28	34.75
Kapenguria	55	1.24	35.11
Bungoma	12	0.56	34.56
Busia	13	0.46	34.11
Nyeri	44	-0.42	36.95
#KG
Bishkek	01	42.87	74.59
Osh	08	40.53	72.8
Jalal-Abad	03	40.93	73
Karakol	07	42.49	78.39
Tokmok	02	42.84	75.3
Kara-Balta	02	42.81	73.85
Naryn	04	41.43	75.99
#KH
Phnom Penh	22	11.56	104.92
Takeo	19	10.99	104.78
Sihanoukville	28	10.61	103.53
Battambang	29	13.1	103.2
Siem Reap	24	13.36	103.86
Paoy Paet	25	13.66	102.56
Kampong Chhnang	03	12.25	104.67
Kampong Cham	02	11.99	105.46
Pursat	12	12.54	103.92
Ta Khmau	07	11.48	104.95
#KP
Pyongyang	12	39.03	125.75
Hamhŭng	03	39.92	127.54
Namp’o	15	38.74	125.41
Sunch’ŏn	15	39.43	125.93
Hŭngnam	03	39.83	127.62
Kaesŏng	06	37.97	126.55
Wŏnsan	09	39.15	127.44
Chongjin	17	41.8	129.78
Sariwŏn	07	38.51	125.76
Sinŭiju	11	40.1	124.4
Haeju	06	38.04	125.71
Kanggye	01	40.97	126.59
Hyesan	13	41.4	128.18
Songnim	07	38.75	125.65
Manp’o	01	41.15	126.29
P’yŏngsŏng	15	39.25	125.87
Hyesan-dong	13	41.4	128.19
Yuktae-dong	03	40.02	128.16
Hongwŏn	03	40.03	127.96
Rajin	18	42.26	130.28
Ongjin	06	37.93	125.36
Kilju	17	40.96	129.33
Chaeryŏng-ŭp	06	38.4	125.62
Anju	15	39.62	125.66
Ŭiju	11	40.2	124.53
#KR
Seoul	11	37.57	126.98
Busan	10	35.1	129.03
Incheon	12	37.46	126.71
Daegu	15	35.87	128.59
Daejeon	19	36.35	127.38
Gwangju	18	35.15	126.92
Suwon	13	37.29	127.01
Goyang-si	13	37.66	126.84
Seongnam-si	13	37.44	127.14
Ulsan	21	35.54	129.32
Bucheon-si	13	37.5	126.78
Jeonju	03	35.82	127.15
Ansan-si	13	37.32	126.82
Cheongju-si	05	36.64	127.49
Anyang-si	13	37.39	126.93
Changwon	20	35.23	128.68
Pohang	14	36.03	129.36
Uijeongbu-si	13	37.74	127.05
Hwaseong-si	13	37.21	126.82
Masan	18	35.13	126.83
Jeju City	01	33.51	126.52
Cheonan	17	36.81	127.15
Kwangmyŏng	13	37.48	126.87
Kimhae	20	35.23	128.88
Chinju	20	35.19	128.08
Yeosu	16	34.76	127.66
Gumi	14	36.11	128.34
Iksan	03	35.94	126.95
Mokpo	16	34.81	126.39
Gunsan	03	35.98	126.71
Wŏnju	06	37.35	127.95
Suncheon	16	34.95	127.49
Sejong	22	36.59	127.29
Chuncheon	06	37.87	127.73
Icheon-si	13	37.28	127.44
Guri-si	13	37.6	127.14
Gangneung	06	37.75	128.87
Yangju	13	37.83	127.06
Osan	13	37.15	127.07
Seogwipo	01	33.25	126.56
Gyeongju	14	35.84	129.21
Gimcheon	14	36.12	128.12
Jeongeup	03	35.6	126.92
Hanam	13	37.54	127.21
Gyeongsan-si	14	35.82	128.74
Andong	14	36.57	128.72
Hwado	13	37.65	127.31
Tonghae	06	37.54	129.11
Asan	17	36.78	127
Wabu	13	37.59	127.22
Namyangju	13	37.64	127.21
Kwangyang	16	34.98	127.59
Hongseong	17	36.6	126.67
Sokcho	06	38.21	128.59
Eisen	14	36.82	128.63
Wanju	03	35.85	127.15
Yangp'yŏng	13	37.49	127.49
Ungsang	20	35.41	129.17
Sinhyeon	20	34.88	128.63
Gwangju	13	37.41	127.26
Mungyeong	14	36.59	128.2
Naesŏ	20	35.25	128.52
Muan	16	34.99	126.48
Hongch’ŏn	06	37.69	127.89
Changnyeong	20	35.54	128.5
Seosan	17	36.78	126.45
Koch'ang	03	35.43	126.7
Gongju	17	36.46	127.12
Kyosai	20	34.85	128.59
Yangsan	20	35.34	129.03
Anseong	13	37.01	127.27
Hwawŏn	15	35.8	128.5
Pubal	13	37.29	127.51
Kosong	06	38.38	128.47
Boryeong	17	36.35	126.6
Chinch'ŏn	05	36.86	127.44
Hwasun	16	35.06	126.99
Nangen	03	35.41	127.39
Okcheon	05	36.3	127.57
Sangju	14	36.42	128.16
Gapyeong	13	37.83	127.51
Yeongam	16	34.8	126.7
Sinan	16	34.83	126.11
Miryang	20	35.49	128.75
#KW
Al Aḩmadī	04	29.08	48.08
Ḩawallī	08	29.33	48.03
As Sālimīyah	08	29.33	48.08
Şabāḩ as Sālim	09	29.26	48.06
Al Farwānīyah	07	29.28	47.96
Al Faḩāḩīl	04	29.08	48.13
Kuwait City	02	29.37	47.98
Ar Rumaythīyah	08	29.31	48.07
Ar Riqqah	04	29.15	48.09
#KZ
Almaty	02	43.26	76.93
Karagandy	12	49.8	73.1
Shymkent	1537272	42.3	69.6
Taraz	17	42.9	71.37
Nur-Sultan	05	51.18	71.45
Pavlodar	11	52.28	76.97
Ust-Kamenogorsk	15	49.97	82.61
Kyzylorda	14	44.85	65.51
Semey	15	50.43	80.27
Aktobe	04	50.28	57.21
Kostanay	13	53.21	63.62
Petropavl	16	54.87	69.15
Oral	07	51.23	51.37
Atyrau	06	47.12	51.88
Temirtau	12	50.05	72.96
Aktau	09	43.65	51.17
Kokshetau	03	53.28	69.4
Rudnyy	13	52.97	63.12
Ekibastuz	11	51.72	75.32
Taldykorgan	01	45.02	78.37
Zhezqazghan	12	47.78	67.77
Zhanaozen	09	43.34	52.86
Turkestan	10	43.3	68.25
Balqash	12	46.85	75
Sarkand	01	45.41	79.92
Baikonur	08	45.62	63.32
Kentau	10	43.52	68.5
Ridder	15	50.34	83.51
Qulsary	06	46.95	54.02
#LA
Vientiane	24	17.97	102.6
Pakse	02	15.12	105.8
Thakhèk	15	17.41	104.83
Savannakhet	20	16.57	104.76
#LB
Beirut	04	33.89	35.5
Ra’s Bayrūt	04	33.9	35.48
Tripoli	09	34.43	35.84
Sidon	06	33.56	35.37
Tyre	06	33.27	35.19
Nabatîyé et Tahta	07	33.38	35.48
Habboûch	07	33.41	35.48
Jounieh	05	33.98	35.62
Zahlé	08	33.85	35.9
Ghazieh	06	33.52	35.37
#LK
Colombo	36	6.94	79.85
Dehiwala-Mount Lavinia	36	6.84	79.87
Moratuwa	36	6.77	79.88
Jaffna	38	9.67	80.01
Negombo	36	7.21	79.84
Pita Kotte	36	6.89	79.9
Sri Jayewardenepura Kotte	36	6.88	79.91
Kandy	29	7.29	80.63
Trincomalee	37	8.58	81.23
Kalmunai	37	7.41	81.83
Galle	34	6.05	80.21
Point Pedro	38	9.82	80.23
Batticaloa	37	7.71	81.69
Katunayaka	36	7.17	79.89
Valvedditturai	38	9.82	80.17
Matara	34	5.95	80.54
Battaramulla South	36	6.9	79.92
Dambulla	29	7.86	80.65
Maharagama	36	6.85	79.93
Kotikawatta	36	6.93	79.91
Anuradhapura	30	8.31	80.41
Vavuniya	38	8.75	80.5
Kolonnawa	36	6.93	79.88
Hendala	36	6.99	79.88
#LR
Monrovia	14	6.3	-10.8
#LS
Maseru	14	-29.32	27.48
Mafeteng	13	-29.82	27.24
#LT
Vilnius	65	54.69	25.28
Kaunas	57	54.9	23.91
Klaipėda	58	55.71	21.14
Šiauliai	61	55.93	23.32
Panevėžys	60	55.73	24.35
Alytus	56	54.4	24.04
Dainava (Kaunas)	57	54.92	23.97
Eiguliai	57	54.93	23.93
#LU
Luxembourg	LU	49.61	6.13
#LV
Riga	25	56.95	24.11
Daugavpils	07	55.88	26.53
Liepāja	16	56.5	21.01
Jelgava	11	56.65	23.71
Jūrmala	13	56.97	23.77
#LY
Tripoli	77	32.89	13.19
Benghazi	69	32.11	20.07
Mişrātah	72	32.38	15.09
Tarhuna	82	32.44	13.63
Al Khums	82	32.65	14.26
Az Zāwīyah	68	32.76	12.73
Zawiya	68	32.75	12.73
Ajdabiya	83	30.76	20.23
Al Ajaylat	67	32.76	12.38
Sabhā	75	27.04	14.43
Sirte	76	31.21	16.59
Al Jadīd	75	27.05	14.4
Tobruk	79	32.09	23.95
Zliten	72	32.47	14.57
Şabrātah	68	32.79	12.49
Tagiura	77	32.88	13.35
Al Marj	66	32.49	20.83
Gharyan	80	32.17	13.02
Darnah	70	32.77	22.64
Al Bayḑā’	63	32.76	21.76
Yafran	80	32.06	12.53
#MA
Casablanca	06	33.59	-7.61
Rabat	04	34.01	-6.83
Fès	03	34.03	-5
Sale	04	34.05	-6.8
Marrakesh	07	31.63	-8
Agadir	09	30.42	-9.6
Tangier	01	35.77	-5.8
Meknès	03	33.89	-5.55
Oujda-Angad	02	34.68	-1.91
Al Hoceïma	01	35.25	-3.94
Kenitra	04	34.26	-6.58
Tétouan	01	35.58	-5.37
Temara	04	33.93	-6.91
Safi	07	32.3	-9.24
Salé Al Jadida	04	34	-6.74
Mohammedia	06	33.69	-7.38
Khouribga	05	32.88	-6.91
Beni Mellal	05	32.34	-6.35
Fès al Bali	03	34.07	-4.95
El Jadid	06	33.26	-8.51
Taza	03	34.21	-4.01
Nador	02	35.17	-2.93
Settat	06	33	-7.62
Larache	01	35.19	-6.16
Ksar El Kebir	01	35	-5.9
Khemisset	04	33.82	-6.07
Guelmim	10	28.99	-10.06
Berrechid	06	33.27	-7.59
Errachidia	08	31.93	-4.43
Oued Zem	05	32.86	-6.57
Al Fqih Ben Çalah	05	32.5	-6.69
Taourirt	02	34.41	-2.9
Berkane	02	34.92	-2.32
Sidi Slimane	04	34.26	-5.93
Sidi Qacem	04	34.22	-5.71
Khenifra	05	32.93	-5.66
Ifrane	03	33.53	-5.11
Taroudant	09	30.47	-8.88
Essaouira	07	31.51	-9.77
Tiflet	04	33.89	-6.31
Oulad Teïma	09	30.39	-9.21
Sefrou	03	33.83	-4.83
Youssoufia	07	32.25	-8.53
Tan-Tan	10	28.44	-11.1
Ouezzane	01	34.8	-5.58
Guercif	03	34.23	-3.35
Ouarzazat	08	30.92	-6.89
Tirhanimîne	01	35.24	-3.95
Dakhla	EH	30.41	-9.56
Tiznit	09	29.7	-9.73
Fnidek	01	35.85	-5.36
#MD
Chisinau	57	47.01	28.86
Tiraspol	58	46.84	29.63
Bălţi	60	47.76	27.93
Bender	62	46.83	29.48
Rîbniţa	58	47.77	29.01
#ME
Podgorica	16	42.44	19.26
Nikšić	12	42.77	18.94
#MG
Antananarivo	11	-18.91	47.54
Toamasina	31	-18.15	49.4
Antsirabe	12	-19.87	47.03
Fianarantsoa	21	-21.45	47.09
Mahajanga	41	-15.72	46.32
Toliara	51	-23.35	43.67
Antsiranana	71	-12.32	49.29
Antanifotsy	12	-19.65	47.32
Ambovombe	52	-25.18	46.09
Ambilobe	71	-13.2	49.05
Amparafaravola	33	-17.59	48.22
#MK
Skopje	F6	42	21.43
Bitola	06	41.03	21.33
Kumanovo	D7	42.13	21.71
Prilep	E3	41.35	21.56
Tetovo	E8	42.01	20.97
Čair	F6	42.02	21.44
Kisela Voda	F6	41.95	21.5
Veles	F1	41.72	21.78
Ohrid	E2	41.12	20.8
Gostivar	D4	41.8	20.91
#ML
Bamako	01	12.65	-8
Sikasso	06	11.32	-5.67
Mopti	04	14.48	-4.18
Koutiala	06	12.39	-5.46
Ségou	05	13.43	-6.22
Gao	09	16.27	-0.04
Kayes	03	14.45	-11.44
Markala	05	13.7	-6.07
#MM
Yangon	17	16.81	96.16
Mandalay	08	21.97	96.08
Nay Pyi Taw	18	19.75	96.13
Mawlamyine	13	16.49	97.63
Kyain Seikgyi Township	05	15.82	98.25
Bago	16	17.34	96.48
Pathein	03	16.78	94.73
Monywa	10	22.11	95.14
Sittwe	01	20.15	92.9
Meiktila	08	20.88	95.86
Myeik	12	12.44	98.6
Taunggyi	11	20.79	97.04
Myingyan	08	21.46	95.39
Dawei	12	14.08	98.19
Pyay	16	18.82	95.22
Hinthada	03	17.65	95.46
Lashio	11	22.94	97.75
Pakokku	15	21.33	95.08
Thaton	13	16.92	97.37
Pyin Oo Lwin	08	22.04	96.46
Yenangyaung	15	20.47	94.87
Taungoo	16	18.94	96.43
Thayetmyo	15	19.32	95.18
Pyinmana	18	19.74	96.21
Magway	15	20.15	94.93
Myitkyina	04	25.38	97.4
Chauk	15	20.9	94.82
Mogok	08	22.92	96.51
Nyaunglebin	16	17.95	96.72
Mudon	13	16.26	97.72
Shwebo	10	22.57	95.7
Sagaing	10	21.88	95.98
Taungdwingyi	15	20.01	95.55
Syriam	17	16.77	96.25
Bogale	03	16.29	95.4
Pyapon	03	16.29	95.68
Yamethin	08	20.43	96.14
Kanbe	17	16.71	96
Kawthoung	12	9.98	98.55
Myaydo	15	19.37	95.22
Minbu	15	20.18	94.88
Tharyarwady	16	17.65	95.79
Thongwa	17	16.76	96.52
Kyaiklat	03	16.45	95.72
Tachilek	11	20.45	99.88
Maubin	03	16.73	95.65
Kyaukse	08	21.61	96.14
Hpa-An	05	16.89	97.63
#MN
Ulan Bator	20	47.91	106.88
Erdenet	25	49.03	104.08
Darhan	23	49.49	105.92
#MO
Macau	02	22.2	113.55
#MQ
Fort-de-France	MQ	14.6	-61.07
#MR
Nouakchott		18.09	-15.98
Nouadhibou	08	20.94	-17.04
Néma	01	16.62	-7.26
Kaédi	04	16.15	-13.5
#MU
Port Louis	18	-20.16	57.5
Beau Bassin-Rose Hill	17	-20.23	57.47
Vacoas	17	-20.3	57.48
Curepipe	17	-20.32	57.53
Quatre Bornes	17	-20.26	57.48
#MV
Male	38	4.18	73.51
#MW
Lilongwe	C	-13.97	33.79
Blantyre	S	-15.78	35.01
Mzuzu	N	-11.47	34.02
Zomba	S	-15.39	35.32
#MX
Mexico City	09	19.43	-99.13
Iztapalapa	09	19.36	-99.06
Ecatepec de Morelos	15	19.6	-99.06
Guadalajara	14	20.67	-103.39
Puebla	21	19.04	-98.2
Juárez	06	31.72	-106.46
Tijuana	02	32.5	-117
León de los Aldama	11	21.13	-101.67
Gustavo Adolfo Madero	09	19.49	-99.11
Zapopan	14	20.72	-103.38
Monterrey	19	25.68	-100.32
Ciudad Nezahualcoyotl	15	19.4	-99.01
Chihuahua	06	28.64	-106.09
Naucalpan de Juárez	15	19.48	-99.24
Mérida	31	20.98	-89.62
Álvaro Obregón	09	19.36	-99.2
San Luis Potosí	24	22.15	-100.98
Aguascalientes	01	21.88	-102.28
Hermosillo	26	29.1	-110.98
Saltillo	07	25.42	-101.01
Mexicali	02	32.63	-115.45
Culiacán	25	24.79	-107.39
Guadalupe	19	25.68	-100.26
Acapulco de Juárez	12	16.85	-99.91
Tlalnepantla	15	19.54	-99.2
Cancún	23	21.17	-86.85
Santiago de Querétaro	22	20.59	-100.39
Coyoacán	09	19.35	-99.16
Santa María Chimalhuacán	15	19.42	-98.95
Torreón	07	25.54	-103.42
Morelia	16	19.7	-101.18
Reynosa	28	26.08	-98.29
Tlaquepaque	14	20.64	-103.29
Tlalpan	09	19.3	-99.16
Tuxtla	05	16.76	-93.11
Cuauhtémoc	09	19.45	-99.15
Victoria de Durango	10	24.02	-104.66
Toluca	15	19.29	-99.65
Ciudad López Mateos	15	19.56	-99.26
Cuautitlán Izcalli	15	19.64	-99.22
Ciudad Apodaca	19	25.78	-100.19
Heroica Matamoros	28	25.88	-97.5
San Nicolás de los Garza	19	25.74	-100.3
Venustiano Carranza	09	19.44	-99.1
Veracruz	30	19.18	-96.14
Xalapa de Enríquez	30	19.53	-96.92
Azcapotzalco	09	19.49	-99.19
Tonalá	14	20.62	-103.23
Xochimilco	09	19.25	-99.1
Benito Juárez	09	19.37	-99.16
Iztacalco	09	19.4	-99.1
Mazatlán	25	23.23	-106.41
Irapuato	11	20.68	-101.36
Nuevo Laredo	28	27.48	-99.52
Miguel Hidalgo	09	19.43	-99.2
Xico	15	19.27	-98.95
Benito Juarez	09	19.4	-99.16
Villahermosa	27	17.99	-92.93
Ciudad General Escobedo	19	25.8	-100.32
Celaya	11	20.52	-100.82
Cuernavaca	17	18.93	-99.23
Tepic	18	21.51	-104.9
Ixtapaluca	15	19.32	-98.88
Tampico	28	22.29	-97.88
Ciudad Victoria	28	23.74	-99.15
Tláhuac	09	19.29	-99.01
Ciudad Obregón	26	27.49	-109.94
Nicolás Romero	15	19.64	-99.31
Ensenada	02	31.87	-116.6
Coacalco	15	19.63	-99.11
Santa Catarina	19	25.67	-100.46
Uruapan	16	19.41	-102.06
Gómez Palacio	10	25.57	-103.5
Los Mochis	25	25.79	-109
Pachuca de Soto	13	20.12	-98.73
Oaxaca	20	17.07	-96.72
Soledad de Graciano Sánchez	24	22.19	-100.94
Colonia del Valle	09	19.39	-99.16
Tehuacán	21	18.46	-97.4
Ojo de Agua	15	19.68	-99.01
Magdalena Contreras	09	19.33	-99.21
Coatzacoalcos	30	18.15	-94.44
Campeche	04	19.84	-90.53
Monclova	07	26.91	-101.42
La Paz	03	24.14	-110.3
Nogales	26	31.31	-110.94
Buenavista	15	19.61	-99.17
Puerto Vallarta	14	20.62	-105.23
Tapachula	05	14.9	-92.26
Ciudad Madero	28	22.27	-97.84
Chilpancingo	12	17.55	-99.51
Poza Rica de Hidalgo	30	20.53	-97.46
Chicoloapan	15	19.42	-98.9
Ciudad del Carmen	04	18.65	-91.83
Chalco	15	19.26	-98.9
Jiutepec	17	18.88	-99.18
Delegación Cuajimalpa de Morelos	09	19.37	-99.29
Salamanca	11	20.57	-101.19
San Luis Río Colorado	26	32.46	-114.77
San Cristóbal de las Casas	05	16.73	-92.64
San Pablo de las Salinas	15	19.67	-99.09
Cuautla	17	18.81	-98.94
Ciudad Benito Juárez	19	25.65	-100.1
Chetumal	23	18.51	-88.3
Piedras Negras	07	28.7	-100.52
Playa del Carmen	23	20.63	-87.08
Zamora	16	19.99	-102.28
Córdoba	30	18.88	-96.93
San Juan del Río	22	20.39	-100
Colima	08	19.25	-103.73
Ciudad Acuña	07	29.32	-100.95
Manzanillo	08	19.12	-104.34
Zacatecas	32	22.77	-102.58
Huixquilucan	15	19.36	-99.35
Ciudad Valles	24	22	-99.01
Guadalupe	32	22.75	-102.52
San Pedro Garza García	19	25.66	-100.41
San Pedro Garza Garcia	19	25.66	-100.4
Fresnillo	32	23.18	-102.87
Orizaba	30	18.85	-97.1
Miramar	28	22.36	-97.9
Iguala de la Independencia	12	18.35	-99.54
Ciudad Delicias	06	28.19	-105.47
Ciudad de Villa de Álvarez	08	19.27	-103.74
Cuauhtémoc	06	28.41	-106.86
Navojoa	26	27.07	-109.44
Heroica Guaymas	26	27.92	-110.9
Minatitlán	30	18	-94.56
Cuautitlán	15	19.67	-99.18
Texcoco de Mora	15	19.51	-98.88
Parral	06	26.93	-105.67
Tepexpan	15	19.61	-98.94
Tulancingo	13	20.08	-98.36
Tuxtepec	20	18.09	-96.13
Colonia Lindavista	15	19.49	-99.12
Apatzingán	16	19.09	-102.36
Lagos de Moreno	14	21.36	-101.94
Temixco	17	18.85	-99.23
Ciudad Guzmán	14	19.7	-103.46
Comitán	05	16.25	-92.14
Ciudad Río Bravo	28	25.99	-98.09
García	19	25.81	-100.6
Tepatitlán de Morelos	14	20.82	-102.76
Cárdenas	27	18	-93.38
Cholula	21	19.06	-98.3
Hacienda Santa Fe	14	20.52	-103.38
Atlixco	21	18.91	-98.44
Tecomán	08	18.92	-103.88
Los Reyes Acaquilpan	15	19.36	-98.98
Ciudad Mante	28	22.74	-98.97
Túxpam de Rodríguez Cano	30	20.96	-97.41
Tlaxcala	29	19.32	-98.2
Heróica Zitácuaro	16	19.44	-100.36
Ocotlán	14	20.36	-102.77
La Piedad	16	20.34	-102.03
Ciudad Lerdo	10	25.54	-103.52
Ciudad Lázaro Cárdenas	16	17.97	-102.22
Matehuala	24	23.65	-100.64
Agua Prieta	26	31.33	-109.55
Kanasín	31	20.93	-89.56
Cozumel	23	20.5	-86.94
Amozoc de Mota	21	19.05	-98.04
Salina Cruz	20	16.18	-95.19
San Martin Texmelucan de Labastida	21	19.28	-98.44
Juchitán de Zaragoza	20	16.44	-95.02
Silao	11	20.94	-101.43
Fuentes del Valle	15	19.63	-99.14
Guanajuato	11	21.02	-101.26
El Pueblito	22	20.54	-100.44
Guasave	25	25.57	-108.47
San Francisco del Rincón	11	21.02	-101.86
San Miguel de Allende	11	20.92	-100.74
San José del Cabo	03	23.06	-109.7
Frontera	07	26.93	-101.45
Cabo San Lucas	03	22.89	-109.91
Cadereyta Jiménez	19	25.59	-100
Valle de Santiago	11	20.39	-101.19
Cadereyta	19	25.58	-99.98
San Mateo Atenco	15	19.27	-99.53
Ixtapa-Zihuatanejo	12	17.64	-101.55
Santa Cruz Xoxocotlán	20	17.03	-96.74
Ramos Arizpe	07	25.54	-100.95
Tultepec	15	19.68	-99.13
Rosarito	02	32.36	-117.05
Tecate	02	32.57	-116.63
Sahuayo de Morelos	16	20.06	-102.72
Guamúchil	25	25.46	-108.08
Linares	19	24.86	-99.57
Tesistán	14	20.8	-103.47
San Andrés Tuxtla	30	18.45	-95.21
Cortazar	11	20.48	-100.96
San Salvador Tizatlalli	15	19.26	-99.59
Ciudad Hidalgo	16	19.69	-100.55
Martínez de la Torre	30	20.07	-97.06
Villa Vicente Guerrero	29	19.12	-98.17
Colonia Nativitas	09	19.38	-99.14
Heroica Caborca	26	30.72	-112.16
Altamira	28	22.39	-97.94
Dolores Hidalgo Cuna de la Independencia Nacional	11	21.16	-100.93
Teziutlan	21	19.82	-97.36
Acámbaro	11	20.03	-100.72
Jacona de Plancarte	15	19.95	-102.31
Puerto Peñasco	26	31.32	-113.54
Huauchinango	21	20.17	-98.05
Nuevo Casas Grandes	06	30.42	-107.91
Pátzcuaro	16	19.52	-101.61
Sabinas	07	27.86	-101.12
San Bernardino Tlaxcalancingo	21	19.03	-98.28
Zinacantepec	15	19.28	-99.73
Jardines de la Silla (Jardines)	19	25.63	-100.19
Santiago Teyahualco	15	19.66	-99.12
Coatepec	30	19.45	-96.96
Papantla de Olarte	30	20.45	-97.32
Rioverde	24	21.93	-99.99
Ciudad de Huajuapan de León	20	17.81	-97.78
Zacapu	16	19.82	-101.79
Matamoros	07	25.53	-103.23
Taxco de Alarcón	12	18.55	-99.61
Arandas	14	20.71	-102.35
Huamantla	29	19.31	-97.93
Uriangato	11	20.14	-101.18
Teoloyucan	15	19.74	-99.18
Acayucan	30	17.95	-94.91
Zumpango	15	19.8	-99.1
Zacapú	16	19.81	-101.79
Polanco	09	19.43	-99.2
#MY
Kota Bharu	03	6.12	102.24
Kuala Lumpur	14	3.14	101.69
Klang	12	3.04	101.44
Kampung Baru Subang	12	3.15	101.53
Johor Bahru	01	1.47	103.76
Subang Jaya	12	3.04	101.58
Ipoh	07	4.58	101.08
Kuching	11	1.55	110.33
Petaling Jaya	12	3.11	101.61
Shah Alam	12	3.09	101.53
Kota Kinabalu	16	5.97	116.07
Sandakan	16	5.84	118.12
Seremban	05	2.73	101.94
Kuantan	06	3.81	103.33
Tawau	16	4.24	117.89
George Town	09	5.41	100.34
Kuala Terengganu	13	5.33	103.14
Sungai Petani	02	5.65	100.49
Miri	11	4.4	113.99
Taiping	07	4.85	100.73
Alor Setar	02	6.12	100.36
Bukit Mertajam	09	5.36	100.47
Sepang	12	2.69	101.75
Sibu	11	2.3	111.82
Malacca	04	2.2	102.24
Kulim	02	5.36	100.56
Kluang	01	2.03	103.32
Skudai	01	1.54	103.66
Batu Pahat	01	1.85	102.93
Bintulu	11	3.17	113.03
Kampung Pasir Gudang Baru	01	1.47	103.88
Kampung Sungai Ara	09	5.33	100.27
Tasek Glugor	09	5.48	100.5
Muar	01	2.04	102.57
Ampang	12	3.15	101.77
Rawang	12	3.32	101.58
Butterworth	09	5.4	100.36
Lahad Datu	16	5.02	118.33
Semenyih	12	2.95	101.84
Marudi	11	4.18	114.32
Port Dickson	05	2.54	101.81
Cukai	13	4.25	103.42
Putatan	16	5.93	116.06
Keningau	16	5.34	116.16
Ulu Tiram	01	1.6	103.82
Labuan	15	5.28	115.25
Taman Senai	01	1.6	103.64
Donggongon	16	5.91	116.1
Segamat	01	2.51	102.82
Kampong Baharu Balakong	12	3.03	101.75
Perai	09	5.38	100.38
Kangar	08	6.44	100.2
Kulai	01	1.66	103.6
Jitra	02	6.27	100.42
Teluk Intan	07	4.02	101.02
Semporna	16	4.48	118.61
Putra Heights	12	2.99	101.57
Temerluh	06	3.45	102.42
Kampong Dungun	07	3.22	101.32
Simpang Empat	07	4.95	100.63
Kuala Selangor	12	3.35	101.25
Kampung Bukit Baharu	04	2.22	102.29
Bandar Labuan	16	5.29	115.27
Kota Tinggi	01	1.74	103.9
Pontian Kechil	01	1.49	103.39
Putrajaya	17	2.94	101.69
#MZ
Maputo	11	-25.97	32.58
Matola	04	-25.96	32.46
Beira	05	-19.84	34.84
Nampula	06	-15.12	39.27
Chimoio	10	-19.12	33.48
Nacala	06	-14.56	40.69
Quelimane	09	-17.88	36.89
Tete	08	-16.16	33.59
Xai-Xai	02	-25.05	33.64
Maxixe	03	-23.86	35.35
Mandimba	07	-14.35	35.65
Ressano Garcia	04	-25.44	32
Lichinga	07	-13.31	35.24
Pemba	01	-12.97	40.52
Dondo	05	-19.61	34.74
António Enes	06	-16.23	39.91
Inhambane	03	-23.86	35.38
Cuamba	07	-14.8	36.54
Montepuez	01	-13.13	39
Chokwé	02	-24.53	32.98
Chibuto	02	-24.69	33.53
Ilha de Moçambique	06	-15.03	40.74
#NA
Windhoek	21	-22.56	17.08
Rundu	40	-17.93	19.77
Walvis Bay	29	-22.96	14.51
#NC
Nouméa	02	-22.27	166.45
#NE
Niamey	08	13.51	2.11
Zinder	07	13.81	8.99
Maradi	04	13.5	7.1
Agadez	01	16.97	7.99
Alaghsas	01	17.02	8.02
Tahoua	06	14.89	5.27
#NG
Lagos	05	6.45	3.39
Kano	29	12	8.52
Ibadan	32	7.38	3.91
Kaduna	23	10.53	7.44
Port Harcourt	50	4.78	7.01
Benin City	37	6.34	5.63
Maiduguri	27	11.85	13.16
Zaria	23	11.11	7.72
Aba	45	5.11	7.37
Jos	49	9.93	8.89
Ilorin	30	8.5	4.54
Oyo	32	7.85	3.93
Enugu	47	6.44	7.5
Abeokuta	16	7.16	3.35
Abuja	11	9.06	7.5
Sokoto	51	13.06	5.24
Onitsha	25	6.15	6.79
Warri	36	5.52	5.75
Ebute Ikorodu	05	6.6	3.49
Okene	41	7.55	6.24
Calabar	22	4.96	8.33
Uyo	21	5.05	7.93
Katsina	24	12.99	7.6
Ado-Ekiti	54	7.62	5.22
Akure	48	7.25	5.19
Lekki	05	6.41	4.09
Bauchi	46	10.31	9.84
Ikeja	05	6.6	3.34
Makurdi	26	7.73	8.52
Minna	31	9.62	6.55
Efon-Alaaye	54	7.66	4.92
Ilesa	42	7.63	4.74
Owo	48	7.2	5.59
Umuahia	45	5.52	7.49
Ondo	48	7.09	4.84
Ikot Ekpene	21	5.18	7.71
Iwo	42	7.64	4.18
Gombe	55	10.29	11.17
Jimeta	35	9.28	12.46
Atani	25	6.01	6.75
Gusau	57	12.17	6.66
Mubi	35	10.27	13.27
Ikire	42	7.37	4.19
Owerri	28	5.48	7.03
Shagamu	16	6.85	3.65
Ijebu-Ode	16	6.82	3.92
Ugep	22	5.81	8.08
Chakwama	39	11.56	9.66
Nnewi	25	6.02	6.92
Ise-Ekiti	54	7.46	5.42
Ila Orangun	42	8.02	4.9
Saki	32	8.67	3.39
Bida	31	9.08	6.01
Awka	25	6.21	7.07
Ijero-Ekiti	54	7.82	5.07
Inisa	42	7.85	4.33
Suleja	31	9.18	7.18
Sapele	36	5.89	5.68
Osogbo	42	7.77	4.56
Kisi	32	9.08	3.85
Gbongan	42	7.48	4.35
Ejigbo	42	7.9	4.31
Funtua	24	11.52	7.31
Igboho	32	8.84	3.76
Buguma	50	4.74	6.86
Ikirun	42	7.91	4.67
Abakaliki	53	6.32	8.11
Okrika	50	4.74	7.08
Amaigbo	45	5.79	7.84
Lafia	56	8.49	8.52
Gashua	44	12.87	11.04
Modakeke	42	7.38	4.26
Bama	27	11.52	13.69
Ilobu	42	7.84	4.49
Jalingo	43	8.89	11.36
Okigwe	28	5.83	7.35
Offa	30	8.15	4.72
Esuk Oron	21	4.8	8.25
Nsukka	47	6.86	7.4
Nguru	44	12.88	10.46
Hadejia	39	12.45	10.04
Ijebu-Igbo	16	6.97	4
Uromi	37	6.7	6.33
Birnin Kebbi	40	12.45	4.2
Pindiga	55	9.98	10.95
Azare	46	11.67	10.19
Nkpor	25	6.15	6.83
Ikere-Ekiti	54	7.5	5.23
Lafiagi	30	8.85	5.42
Kontagora	31	10.4	5.47
Kuje	11	8.88	7.23
Yola	35	9.21	12.48
Biu	27	10.61	12.19
Olupona	42	7.6	4.18
Lere	23	10.39	8.57
Wukari	43	7.87	9.78
Igbo-Ora	32	7.43	3.29
Emure-Ekiti	54	7.44	5.46
Isieke	53	6.38	8.04
Ifo	16	6.81	3.2
Igede-Ekiti	54	7.67	5.13
Effium	53	6.63	8.06
Idanre	48	7.11	5.12
Potiskum	44	11.71	11.08
Keffi	56	8.85	7.87
Makoko	05	6.5	3.39
Epe	05	6.58	3.98
Gamboru	27	12.37	14.21
Ogaminana	41	7.59	6.22
Ihiala	25	5.85	6.86
Ipoti	54	7.87	5.08
Lalupon	32	7.47	4.07
Ughelli	36	5.49	6
Bende	45	5.56	7.63
Oke Mesi	42	7.82	4.92
Kafanchan	23	9.58	8.29
Ikom	22	5.97	8.71
Agulu	25	6.1	7.06
Daura	44	11.55	11.41
Numan	35	9.46	12.03
Kagoro	23	9.61	8.39
Ode	48	7.79	5.71
Igbo-Ukwu	25	6.02	7.02
Aramoko-Ekiti	54	7.7	5.04
Igbara-Odo	54	7.5	5.06
Ozubulu	25	5.96	6.85
Aku	47	6.71	7.32
Oyan	42	8.05	4.77
Jega	40	12.22	4.38
Asaba	36	6.2	6.73
Ohafia-Ifigh	45	5.61	7.81
Afikpo	53	5.89	7.94
Apomu	42	7.35	4.18
Fiditi	32	7.71	3.92
Orita Eruwa	32	7.55	3.43
Eha Amufu	47	6.66	7.76
Malumfashi	24	11.79	7.62
Kaura Namoda	57	12.59	6.59
Enugu-Ukwu	25	6.17	7.01
Idah	41	7.11	6.74
Obonoma	50	4.71	6.79
Agbor	36	6.25	6.19
Ezza-Ohu	53	6.44	8.08
Uga	25	5.94	7.08
Nkwerre	28	5.76	7.1
Auchi	37	7.07	6.26
Lokoja	41	7.8	6.74
Ekpoma	37	6.74	6.14
Ijebu-Jesa	42	7.68	4.82
#NI
Managua	10	12.13	-86.25
León	08	12.44	-86.88
Masaya	11	11.97	-86.09
Chinandega	03	12.63	-87.13
Matagalpa	12	12.93	-85.92
Estelí	05	13.09	-86.35
Granada	06	11.93	-85.96
Jinotega	07	13.09	-86
El Viejo	03	12.66	-87.17
Nueva Guinea	18	11.69	-84.46
Tipitapa	10	12.2	-86.1
Juigalpa	04	12.11	-85.36
Ciudad Sandino	10	12.16	-86.34
#NL
Amsterdam	07	52.37	4.89
Rotterdam	11	51.92	4.48
The Hague	11	52.08	4.3
Utrecht	09	52.09	5.12
Eindhoven	06	51.44	5.48
Tilburg	06	51.56	5.09
Groningen	04	53.22	6.57
Almere Stad	16	52.37	5.21
Breda	06	51.59	4.78
Nijmegen	03	51.84	5.85
Enschede	15	52.22	6.9
Haarlem	07	52.38	4.64
Arnhem	03	51.98	5.91
Zaanstad	07	52.45	4.81
Amersfoort	09	52.16	5.39
Apeldoorn	03	52.21	5.97
's-Hertogenbosch	06	51.7	5.3
Hoofddorp	07	52.3	4.69
Maastricht	05	50.85	5.69
Leiden	11	52.16	4.49
Dordrecht	11	51.81	4.67
Zoetermeer	11	52.06	4.49
Zwolle	15	52.51	6.09
Deventer	15	52.26	6.16
Delft	11	52.01	4.36
Alkmaar	07	52.63	4.75
Heerlen	05	50.88	5.98
Venlo	05	51.37	6.17
Leeuwarden	02	53.2	5.81
Amsterdam-Zuidoost	07	52.31	4.97
Hilversum	07	52.22	5.18
Hengelo	15	52.27	6.79
Amstelveen	07	52.3	4.86
Roosendaal	06	51.53	4.47
Purmerend	07	52.51	4.96
Oss	06	51.77	5.52
Schiedam	11	51.92	4.39
Spijkenisse	11	51.85	4.33
Helmond	06	51.48	5.66
Vlaardingen	11	51.91	4.34
Almelo	15	52.36	6.66
Gouda	11	52.02	4.71
Zaandam	07	52.44	4.83
Lelystad	16	52.51	5.48
Alphen aan den Rijn	11	52.13	4.66
Hoorn	07	52.64	5.06
Velsen-Zuid	07	52.46	4.65
Ede	03	52.03	5.66
Bergen op Zoom	06	51.5	4.29
Capelle aan den IJssel	11	51.93	4.58
Assen	01	53	6.56
Nieuwegein	09	52.03	5.08
Veenendaal	09	52.03	5.56
Zeist	09	52.09	5.23
Den Helder	07	52.96	4.76
Hardenberg	15	52.58	6.62
Emmen	01	52.78	6.91
Oosterhout	06	51.65	4.86
#NO
Oslo	12	59.91	10.75
Bergen	46	60.39	5.32
Trondheim	21	63.43	10.4
Stavanger	14	58.97	5.73
Drammen	30	59.74	10.2
Fredrikstad	30	59.22	10.93
Kristiansand	42	58.15	8
Sandnes	14	58.85	5.74
Asker	30	59.83	10.44
Tromsø	54	69.65	18.96
Sarpsborg	30	59.28	11.11
Skien	38	59.21	9.61
#NP
Kathmandu	3	27.7	85.32
Pokhara	4	28.27	83.97
Pātan	3	27.68	85.31
Biratnagar	1	26.46	87.27
Birgañj	2	27.02	84.88
Dharān	1	26.81	87.28
Bharatpur	3	27.68	84.44
Janakpur	2	26.73	85.93
Dhangaḍhi̇̄	7	28.7	80.59
Butwāl	5	27.7	83.45
Mahendranagar	7	28.96	80.18
Hetauda	3	27.43	85.03
Madhyapur Thimi	3	27.68	85.39
Triyuga	1	26.79	86.7
Inaruwa	1	26.61	87.15
Nepalgunj	5	28.05	81.62
Siddharthanagar	5	27.5	83.45
Gulariyā	5	28.21	81.35
#NZ
Auckland	E7	-36.85	174.76
Wellington	G2	-41.29	174.78
Christchurch	E9	-43.53	172.63
Manukau City	E7	-36.99	174.88
North Shore	E7	-36.8	174.75
Hamilton	G1	-37.78	175.28
Dunedin	F7	-45.87	170.5
Tauranga	E8	-37.69	176.17
Lower Hutt	G2	-41.22	174.92
Palmerston North	F3	-40.36	175.61
Rotorua	E8	-38.14	176.25
Hastings	F2	-39.64	176.85
Nelson	F5	-41.27	173.28
Napier	F2	-39.49	176.91
Mangere	E7	-36.97	174.8
Porirua	G2	-41.13	174.85
Whangarei	F6	-35.73	174.32
#OM
Muscat	06	23.58	58.41
Seeb	06	23.67	58.19
Şalālah	08	17.02	54.09
Bawshar	06	23.58	58.4
Sohar	11	24.35	56.71
As Suwayq	11	23.85	57.44
‘Ibrī	09	23.23	56.52
Şaḩam	11	24.17	56.89
Barkā’	02	23.68	57.89
Rustaq	02	23.39	57.42
Al Buraymī	10	24.25	55.79
Nizwá	01	22.93	57.53
Sur	04	22.57	59.53
Bahlā’	01	22.98	57.3
Al Khābūrah	11	23.97	57.09
#PA
Panamá	08	8.99	-79.52
San Miguelito	08	9.05	-79.47
Juan Díaz	08	9.05	-79.45
David	02	8.43	-82.43
Arraiján	13	8.95	-79.66
Colón	04	9.35	-79.9
Las Cumbres	08	9.09	-79.53
La Chorrera	13	8.88	-79.78
Pedregal	08	9.07	-79.43
Tocumen	08	9.09	-79.38
#PE
Lima	LMA	-12.04	-77.03
Arequipa	04	-16.4	-71.53
Callao	07	-12.06	-77.12
Trujillo	13	-8.12	-79.03
Chiclayo	14	-6.77	-79.84
Iquitos	16	-3.75	-73.25
Huancayo	12	-12.07	-75.2
Piura	20	-5.19	-80.63
Chimbote	02	-9.09	-78.58
Cusco	08	-13.52	-71.97
Pucallpa	25	-8.38	-74.55
Tacna	23	-18.01	-70.25
Santiago de Surco	15	-12.14	-77.01
Ica	11	-14.07	-75.73
Juliaca	21	-15.5	-70.13
Sullana	20	-4.9	-80.69
Chincha Alta	11	-13.41	-76.13
Huánuco	10	-9.93	-76.24
Ayacucho	05	-13.16	-74.22
Cajamarca	06	-7.16	-78.5
Puno	21	-15.84	-70.02
Tumbes	24	-3.57	-80.45
Talara	20	-4.58	-81.27
Chosica	15	-11.94	-76.71
Huaraz	02	-9.53	-77.53
Cerro de Pasco	19	-10.67	-76.26
Chulucanas	20	-5.09	-80.16
San Isidro	15	-12.12	-77.05
Huaral	15	-11.49	-77.21
Pisco	11	-13.71	-76.21
Catacaos	20	-5.27	-80.68
Paita	20	-5.09	-81.11
Abancay	03	-13.63	-72.88
Huacho	15	-11.11	-77.6
Moquegua	18	-17.2	-70.94
Ilo	18	-17.63	-71.34
Tingo María	10	-9.3	-76
Jaén	06	-5.71	-78.81
Tarma	12	-11.42	-75.69
#PG
Port Moresby	20	-9.48	147.15
Lae	14	-6.72	147
#PH
Quezon City	NCR	14.65	121.05
Manila	NCR	14.6	120.98
Caloocan City	NCR	14.65	120.97
Budta	14	7.2	124.44
Davao	11	7.07	125.61
Malingao	12	7.16	124.48
Cebu City	07	10.32	123.89
General Santos	12	6.11	125.17
Taguig	NCR	14.52	121.08
Pasig City	NCR	14.59	121.06
Las Piñas	NCR	14.45	120.98
Antipolo	40	14.63	121.12
Makati City	NCR	14.55	121.03
Zamboanga	09	6.91	122.07
Bacolod City	06	10.67	122.95
Mansilingan	06	10.63	122.98
Cagayan de Oro	10	8.48	124.65
Dasmariñas	40	14.33	120.94
Pasay	NCR	14.54	121
Iloilo	06	10.7	122.56
San Jose del Monte	03	14.81	121.05
Bacoor	40	14.46	120.94
Lapu-Lapu City	07	10.31	123.95
Iligan	10	8.23	124.24
Mandaue City	07	10.32	123.92
Calamba	40	14.21	121.17
Iligan City	12	8.25	124.4
Butuan	13	8.95	125.54
Cabuyao	40	14.27	121.13
Mandaluyong City	NCR	14.58	121.04
Biñan	40	14.34	121.08
Angeles City	03	15.15	120.58
Santol	03	15.16	120.57
Cainta	40	14.58	121.12
Baguio	15	16.42	120.59
San Pedro	40	14.36	121.05
Mantampay	10	8.17	124.22
San Fernando	03	15.03	120.68
Libertad	13	8.94	125.5
Navotas	NCR	14.67	120.95
Tacloban	08	11.24	125
Batangas	40	13.76	121.06
Magugpo Poblacion	11	7.45	125.8
Taytay	40	14.56	121.13
Lucena	40	13.93	121.62
Puerto Princesa	41	9.74	118.74
Olongapo	03	14.83	120.28
Cabanatuan City	03	15.49	120.97
Binangonan	40	14.46	121.19
Santa Rosa	40	14.31	121.11
Imus	40	14.43	120.94
Lipa City	40	13.94	121.16
San Pablo	40	14.07	121.33
Malolos	03	14.84	120.81
Ormoc	08	11.01	124.61
Panalanoy	08	11.25	125.01
Mabalacat City	03	15.22	120.57
Pagadian	09	7.83	123.44
Meycauayan	03	14.74	120.96
Tarlac City	03	15.48	120.6
Legaspi	05	13.14	123.74
Cotabato	14	7.22	124.25
Naga	05	13.62	123.18
Dagupan	01	16.04	120.33
Toledo	07	10.38	123.64
Guyong	03	14.84	120.98
Bago City	06	10.53	122.83
Marawi City	14	8	124.28
Kabankalan	06	9.98	122.81
Baliuag	03	14.95	120.9
Rodriguez	40	14.76	121.2
San Mateo	40	14.7	121.12
Talisay	07	10.24	123.85
Muricay	09	7.83	123.48
Bulaon	03	15.08	120.66
Cadiz	06	10.95	123.29
Koronadal	12	6.5	124.85
Hagonoy	03	14.83	120.73
San Juan	NCR	14.6	121.03
Silang	40	14.22	120.97
San Jose	41	12.35	121.07
Digos	11	6.75	125.36
Cavite City	40	14.48	120.9
Tuguegarao	02	17.62	121.72
Dumaguete	07	9.31	123.3
Santiago	02	16.69	121.55
Santa Cruz	40	14.28	121.42
Mati	11	6.96	126.22
Tanza	NCR	14.68	120.94
Roxas City	06	11.59	122.75
Laoag	01	18.2	120.6
Pulong Santa Cruz	40	14.27	121.08
Urdaneta	01	15.98	120.57
Jolo	14	6.05	121
Bocaue	03	14.8	120.93
General Trias	40	14.39	120.88
Los Baños	40	14.17	121.24
Iriga City	05	13.43	123.41
Dipolog	09	8.57	123.33
Ozamiz City	10	8.15	123.84
Calumpit	03	14.92	120.77
Mangaldan	01	16.07	120.4
Arayat	03	15.15	120.77
Surigao	13	9.79	125.5
Angono	40	14.53	121.15
Victorias	06	10.9	123.07
Tagbilaran City	07	9.66	123.85
Panabo	11	7.31	125.68
Mariveles	03	14.43	120.49
Binonga	06	10.77	122.98
NIA Valencia	10	7.91	125.09
Marilao	03	14.76	120.95
San Fernando	01	16.62	120.32
Sorsogon	05	12.97	123.99
Kidapawan	12	7.01	125.09
Norzagaray	03	14.91	121.05
Gapan	03	15.31	120.95
Daet	05	14.11	122.96
Apalit	03	14.95	120.77
Pulilan	03	14.9	120.85
Polangui	05	13.29	123.49
Guiguinto	03	14.83	120.88
Kawit	40	14.44	120.9
Balanga	03	14.68	120.54
Ilagan	02	17.15	121.89
Sagay	06	10.94	123.42
Capas	03	15.33	120.59
Solana	02	17.65	121.69
Bulacan	03	14.79	120.88
Tagaytay	40	14.1	120.93
Plaridel	03	14.89	120.86
Mariano	10	8.83	125.12
Danao	07	10.52	124.03
Magalang	03	15.22	120.66
Libon	05	13.3	123.44
Tanauan	40	14.09	121.15
Catbalogan	08	11.78	124.89
Calbayog City	08	12.07	124.6
Subic	03	14.88	120.23
Bislig	13	8.22	126.32
City of Isabela	14	6.7	121.97
Dinalupihan	03	14.88	120.45
Calapan	41	13.41	121.18
San Ildefonso	03	15.08	120.94
San Miguel	03	15.14	120.98
Bais	07	9.59	123.12
Talisay	06	10.74	122.97
Talavera	03	15.59	120.92
Concepcion	03	15.33	120.66
Polomolok	12	6.22	125.06
Nasugbu	40	14.07	120.63
Tinongan	06	10.22	123.04
Minglanilla	07	10.24	123.8
Malaybalay	10	8.16	125.13
Candelaria	40	13.93	121.42
Ualog	06	10.57	123.39
Tanay	40	14.5	121.28
Obando	03	14.71	120.94
Balagtas	03	14.82	120.87
Manaoag	01	16.04	120.49
Bañga	12	6.42	124.78
Tabaco	05	13.36	123.73
Santo Tomas	40	14.11	121.14
Kalibo (poblacion)	06	11.71	122.36
Lingayen	01	16.02	120.23
Carmona	40	14.31	121.06
Lubao	03	14.94	120.6
Naic	40	14.32	120.77
Tacurong	12	6.69	124.68
Batac City	01	18.06	120.56
Patuto	40	14.12	120.97
Limay	03	14.56	120.6
Maluñgun	12	6.28	125.28
Monkayo	11	7.82	126.05
Dapitan	09	8.66	123.42
Balayan	40	13.94	120.73
#PK
Karachi	05	24.86	67.01
Lahore	04	31.56	74.35
Faisalabad	04	31.42	73.09
Rawalpindi	04	33.6	73.05
Multan	04	30.2	71.48
Hyderabad	05	25.39	68.37
Gujranwala	04	32.16	74.19
Peshawar	03	34.01	71.58
Rahim Yar Khan	04	28.42	70.3
Quetta	02	30.18	67
Muzaffarābād	06	34.37	73.47
Battagram	03	34.68	73.02
Kotli	06	33.52	73.9
Islamabad	08	33.72	73.04
Bahawalpur	04	29.4	71.68
Sargodha	04	32.09	72.67
Sialkot	04	32.49	74.53
Sukkur	05	27.7	68.86
Larkana	05	27.56	68.21
Shekhupura	04	31.71	73.99
Bhimbar	06	32.97	74.08
Jhang Sadr	04	31.27	72.32
Gujrat	04	32.57	74.08
Mardan	03	34.2	72.05
Malir Cantonment	05	24.94	67.21
Kasur	04	31.12	74.45
Mingora	03	34.78	72.36
Dera Ghazi Khan	04	30.05	70.64
Sahiwal	04	30.67	73.1
Nawabshah	05	26.24	68.4
Okara	04	30.81	73.45
Mirpur Khas	05	25.53	69.01
Chiniot	04	31.72	72.98
Shahkot	04	31.57	73.49
Kamoke	04	31.98	74.22
Saddiqabad	04	28.31	70.13
Būrewāla	04	30.17	72.65
Jacobabad	05	28.28	68.44
Muzaffargarh	04	30.07	71.19
Muridke	04	31.8	74.26
Shikarpur	05	27.96	68.64
Hafizabad	04	32.07	73.69
Kohat	03	33.58	71.45
Tordher	03	33.99	72.29
Jhelum	04	32.93	73.73
Khanpur	04	28.65	70.66
Khuzdar	02	27.81	66.61
Dadu	05	26.73	67.78
Gojra	04	31.15	72.68
Mandi Bahauddin	04	32.59	73.49
Tando Allahyar	05	25.46	68.72
Daska Kalan	04	32.32	74.35
Pakpattan	04	30.34	73.39
Bahawalnagar	04	30.55	73.39
Tando Adam	05	25.77	68.66
Khairpur Mir’s	05	27.53	68.76
New Mirpur	06	33.15	73.75
Chishtian	04	29.8	72.86
Abbottabad	03	34.15	73.21
Jaranwala	04	31.33	73.42
Ahmadpur East	04	29.14	71.26
Vihari	04	30.04	72.36
Kamalia	04	30.73	72.65
Kot Addu	04	30.47	70.97
Khushāb	04	32.3	72.35
Wazirabad	04	32.44	74.12
Dera Ismail Khan	03	31.83	70.9
Chakwal	04	32.93	72.85
Swabi	03	34.12	72.47
Lodhran	04	29.53	71.63
Nowshera Cantonment	03	34	72
Charsadda	03	34.15	71.74
Jalalpur Jattan	04	32.64	74.21
Mianwali	04	32.58	71.53
Chaman	02	30.92	66.45
Kandhkot	05	28.25	69.18
Hasilpur	04	29.69	72.55
Arifwala	04	30.29	73.07
Mianke Mor	04	31.2	73.95
Attock City	04	33.77	72.36
Chichawatni	04	30.53	72.69
Bhakkar	04	31.63	71.06
Kharian	04	32.82	73.89
Layyah	04	30.96	70.94
Kambar	05	27.59	68
Moro	05	26.66	68
Mian Channun	04	30.44	72.36
Turbat	02	26	63.05
Shahdad Kot	05	27.85	67.91
Bhalwal	04	32.27	72.9
Dipalpur	04	30.67	73.65
Badin	05	24.66	68.84
Pano Aqil	05	27.86	69.11
Kotri	05	25.37	68.31
Tando Muhammad Khan	05	25.12	68.54
Harunabad	04	29.61	73.14
Pattoki	04	31.02	73.85
Chenab Nagar	04	31.76	72.91
Kahror Pakka	04	29.62	71.91
Gujar Khan	04	33.25	73.3
Kot Malik Barkhurdar	02	30.2	66.99
Chuchar-kana Mandi	04	31.75	73.8
Toba Tek Singh	04	30.97	72.48
Narowal	04	32.1	74.87
Shorkot	03	31.91	70.88
Shahdadpur	05	25.93	68.62
Shabqadar	03	34.22	71.55
Mansehra	03	34.33	73.2
Shujaabad	04	29.88	71.29
Haveli Lakha	04	30.45	73.69
Lala Musa	04	32.7	73.96
Mailsi	04	29.8	72.17
Shakargarh	04	32.26	75.16
Ghotki	05	28	69.32
Sibi	02	29.54	67.88
Jampur	04	29.64	70.6
Sambrial	04	32.48	74.35
Sanghar	05	26.05	68.95
Hujra Shah Muqim	04	30.74	73.82
Kabirwala	04	30.4	71.86
Chunian	04	30.97	73.98
Sangla Hill	04	31.72	73.38
Haripur	03	34	72.93
Nankana Sahib	04	31.45	73.71
Pasrur	04	32.26	74.66
Gwadar	02	25.12	62.33
Rajanpur	04	29.1	70.33
Rohri	05	27.69	68.9
Zhob	02	31.34	69.45
Matli	05	25.04	68.66
Rawala Kot	06	33.86	73.76
#PL
Warsaw	78	52.23	21.01
Łódź	74	51.77	19.47
Kraków	77	50.06	19.94
Wrocław	72	51.1	17.03
Poznań	86	52.41	16.93
Gdańsk	82	54.35	18.65
Szczecin	87	53.43	14.55
Bydgoszcz	73	53.12	18.01
Lublin	75	51.25	22.57
Katowice	83	50.26	19.03
Białystok	81	53.13	23.16
Gdynia	82	54.52	18.53
Częstochowa	83	50.8	19.12
Sosnowiec	83	50.29	19.1
Radom	78	51.4	21.15
Mokotów	78	52.19	21.03
Toruń	73	53.01	18.6
Kielce	84	50.87	20.63
Gliwice	83	50.3	18.68
Zabrze	83	50.32	18.79
Bytom	83	50.35	18.93
Praga Południe	78	52.24	21.09
Bielsko-Biala	83	49.82	19.05
Olsztyn	85	53.78	20.49
Rzeszów	80	50.04	22
Ursynów	78	52.15	21.05
Ruda Śląska	83	50.26	18.86
Wola	78	52.24	20.99
Rybnik	83	50.1	18.54
Bielany	78	52.29	20.94
Śródmieście	78	52.23	21.02
Dąbrowa Górnicza	83	50.33	19.2
Tychy	83	50.14	18.97
Opole	79	50.67	17.93
Elbląg	85	54.15	19.41
Płock	78	52.55	19.71
Wałbrzych	72	50.77	16.28
Gorzów Wielkopolski	76	52.74	15.23
Targówek	78	52.29	21.05
Włocławek	73	52.65	19.07
Zielona Góra	76	51.94	15.51
Tarnów	77	50.01	20.99
Chorzów	83	50.31	18.97
Kalisz	86	51.76	18.09
Koszalin	87	54.19	16.17
Legnica	72	51.21	16.16
Bemowo	78	52.25	20.91
Grudziądz	73	53.48	18.75
Słupsk	82	54.46	17.03
Jaworzno	83	50.21	19.27
Jastrzębie Zdrój	83	49.96	18.57
Ochota	78	52.22	20.99
Praga Północ	78	52.25	21.03
Białołeka	78	52.32	20.97
Jelenia Góra	72	50.9	15.73
Nowy Sącz	77	49.62	20.7
Konin	86	52.22	18.25
Piotrków Trybunalski	74	51.41	19.7
Inowrocław	73	52.8	18.26
Lubin	72	51.4	16.2
Siedlce	78	52.17	22.29
Piła	86	53.15	16.74
Mysłowice	83	50.21	19.17
Ostrowiec Świętokrzyski	84	50.93	21.39
Siemianowice Śląskie	83	50.33	19.03
Ostrów Wielkopolski	86	51.66	17.81
Stargard	87	53.34	15.05
Pabianice	74	51.66	19.35
Gniezno	86	52.53	17.58
Fordon	73	53.15	18.17
Suwałki	81	54.11	22.93
Głogów	72	51.66	16.08
Chełm	75	51.14	23.47
Tomaszów Mazowiecki	74	51.53	20.01
Przemyśl	80	49.78	22.77
Stalowa Wola	80	50.58	22.05
Zamość	75	50.72	23.25
Kędzierzyn-Koźle	79	50.35	18.23
Łomża	81	53.18	22.06
Leszno	86	51.84	16.57
Żory	83	50.05	18.7
Bełchatów	74	51.37	19.36
Wawer	78	52.2	21.18
Mielec	80	50.29	21.42
Tarnowskie Góry	83	50.45	18.86
Świdnica	72	50.84	16.49
Tczew	82	54.09	18.78
Piekary Śląskie	83	50.38	18.93
Racibórz	83	50.09	18.22
Będzin	83	50.33	19.13
Zgierz	74	51.86	19.41
Biała Podlaska	75	52.03	23.12
Ełk	85	53.83	22.36
Świętochłowice	83	50.3	18.92
Pruszków	78	52.17	20.81
Ostrołęka	78	53.09	21.58
Starachowice	84	51.04	21.07
Zawiercie	83	50.49	19.42
Żoliborz	78	52.27	20.99
Legionowo	78	52.4	20.93
Tarnobrzeg	80	50.57	21.68
#PR
San Juan	127	18.47	-66.11
Bayamón	021	18.4	-66.16
Carolina	031	18.38	-65.96
Ponce	113	18.01	-66.62
Caguas	025	18.23	-66.05
Guaynabo	061	18.36	-66.11
Mayagüez	097	18.2	-67.14
Trujillo Alto	139	18.35	-66.01
#PS
East Jerusalem	WE	31.78	35.23
Gaza	GZ	31.5	34.47
Khān Yūnis	GZ	31.34	34.31
Jabālyā	GZ	31.53	34.48
Hebron	WE	31.53	35.09
Nablus	WE	32.22	35.25
Rafaḩ	GZ	31.3	34.24
Dayr al Balaḩ	GZ	31.42	34.35
Bayt Lāhyā	GZ	31.55	34.5
#PT
Lisbon	14	38.72	-9.13
Porto	17	41.15	-8.61
Amadora	14	38.75	-9.23
Braga	04	41.55	-8.42
Setúbal	19	38.52	-8.89
Coimbra	07	40.21	-8.42
Queluz	14	38.76	-9.25
Funchal	10	32.67	-16.93
Cacém	14	38.77	-9.3
Vila Nova de Gaia	17	41.12	-8.61
Algueirão	14	38.8	-9.34
Loures	14	38.83	-9.17
Felgueiras	17	41.37	-8.19
Évora	08	38.57	-7.9
Rio de Mouro	14	38.77	-9.33
Odivelas	14	38.79	-9.18
Aveiro	02	40.64	-8.65
Amora	19	38.63	-9.12
Corroios	19	38.64	-9.15
Barreiro	19	38.66	-9.07
Monsanto	18	39.46	-8.71
#PY
Asunción	22	-25.29	-57.65
Ciudad del Este	01	-25.51	-54.61
San Lorenzo	06	-25.34	-57.51
Capiatá	06	-25.36	-57.45
Lambaré	06	-25.35	-57.61
Fernando de la Mora	06	-25.34	-57.52
Limpio	06	-25.17	-57.49
Nemby	06	-25.39	-57.54
Pedro Juan Caballero	02	-22.55	-55.73
Encarnación	11	-27.33	-55.87
Mariano Roque Alonso	06	-25.21	-57.53
Itauguá	06	-25.39	-57.35
Villa Elisa	06	-25.37	-57.59
Villa Hayes	16	-25.09	-57.52
San Antonio	06	-25.42	-57.55
Caaguazú	04	-25.47	-56.02
Presidente Franco	01	-25.56	-54.61
Coronel Oviedo	04	-25.44	-56.44
#QA
Doha	01	25.29	51.53
Ar Rayyān	06	25.29	51.42
#RE
Saint-Denis	RE	-20.88	55.45
Saint-Paul	RE	-21.01	55.27
Saint-Pierre	RE	-21.34	55.48
Le Tampon	RE	-21.28	55.52
#RO
Bucharest	10	44.43	26.11
Sector 3	10	44.42	26.17
Sector 6	10	44.44	26.02
Sector 2	10	44.45	26.13
Iaşi	23	47.17	27.6
Cluj-Napoca	13	46.77	23.6
Timişoara	36	45.75	21.23
Craiova	17	44.32	23.8
Constanţa	14	44.18	28.63
Galaţi	18	45.44	28.05
Sector 4	10	44.38	26.12
Braşov	09	45.65	25.61
Sector 5	10	44.39	26.07
Ploieşti	30	44.95	26.02
Sector 1	10	44.49	26.05
Brăila	08	45.27	27.97
Oradea	05	47.05	21.92
Bacău	04	46.57	26.91
Arad	02	46.18	21.32
Piteşti	03	44.85	24.87
Sibiu	33	45.8	24.15
Târgu-Mureş	27	46.54	24.56
Baia Mare	25	47.66	23.57
Buzău	11	45.15	26.83
Botoşani	07	47.75	26.67
Satu Mare	32	47.8	22.86
Râmnicu Vâlcea	39	45.1	24.37
Suceava	34	47.63	26.25
Piatra Neamţ	28	46.92	26.33
Drobeta-Turnu Severin	26	44.63	22.65
Târgu Jiu	19	45.05	23.28
Tulcea	37	45.18	28.81
Târgovişte	16	44.93	25.46
Bistriţa	06	47.13	24.5
Reşiţa	12	45.3	21.89
Slatina	29	44.43	24.37
Focșani	40	45.7	27.18
Vaslui	38	46.63	27.73
Hunedoara	21	45.75	22.9
Giurgiu	42	43.89	25.96
Roman	28	46.92	26.93
Bârlad	38	46.23	27.67
Deva	21	45.88	22.9
Alba Iulia	01	46.07	23.58
Zalău	31	47.2	23.05
Sfântu Gheorghe	15	45.87	25.78
Turda	13	46.57	23.78
Mediaş	33	46.17	24.35
Slobozia	22	44.56	27.36
#RS
Belgrade	SE	44.8	20.47
Niš	SE	43.32	21.9
Novi Sad	VO	45.25	19.84
Zemun	SE	44.85	20.4
Kragujevac	SE	44.02	20.92
Čačak	SE	43.89	20.35
Subotica	VO	46.1	19.67
Leskovac	SE	43	21.95
Novi Pazar	SE	43.14	20.51
Kraljevo	SE	43.73	20.69
Zrenjanin	VO	45.38	20.38
Pančevo	VO	44.87	20.64
Kruševac	SE	43.58	21.33
Užice	SE	43.86	19.85
Smederevo	SE	44.66	20.93
Valjevo	SE	44.28	19.9
Vranje	SE	42.55	21.9
Šabac	SE	44.75	19.69
#RU
Moscow	48	55.75	37.62
Saint Petersburg	66	59.94	30.31
Novosibirsk	53	55.04	82.93
Yekaterinburg	71	56.85	60.61
Nizhniy Novgorod	51	56.33	44
Samara	65	53.2	50.15
Omsk	54	54.99	73.37
Kazan	73	55.79	49.12
Rostov-na-Donu	61	47.23	39.72
Chelyabinsk	13	55.15	61.43
Ufa	08	54.74	55.97
Volgograd	84	48.72	44.5
Perm	90	58.01	56.25
Krasnoyarsk	91	56.02	92.87
Saratov	67	51.54	46.01
Voronezh	86	51.67	39.18
Tol’yatti	65	53.53	49.35
Krasnodar	38	45.04	38.98
Ulyanovsk	81	54.33	48.39
Izhevsk	80	56.85	53.2
Yaroslavl	88	57.63	39.87
Barnaul	04	53.36	83.76
Vladivostok	59	43.11	131.87
Irkutsk	20	52.3	104.3
Khabarovsk	30	48.48	135.08
Khabarovsk Vtoroy	30	48.44	135.13
Orenburg	55	51.77	55.1
Novokuznetsk	29	53.76	87.11
Ryazan’	62	54.63	39.69
Tyumen	78	57.15	65.53
Lipetsk	43	52.6	39.57
Penza	57	53.2	45
Naberezhnyye Chelny	73	55.73	52.41
Kalininskiy	66	60	30.39
Astrakhan	07	46.35	48.04
Makhachkala	17	42.98	47.5
Tomsk	75	56.5	84.97
Kemerovo	29	55.33	86.08
Tula	76	54.2	37.62
Kirov	33	58.6	49.66
Cheboksary	16	56.13	47.25
Kaliningrad	23	54.71	20.51
Bryansk	10	53.25	34.37
Ivanovo	21	57	40.97
Magnitogorsk	13	53.42	59.05
Kursk	41	51.74	36.19
Tver	77	56.86	35.9
Nizhny Tagil	71	57.92	59.97
Stavropol’	70	45.04	41.97
Ulan-Ude	11	51.83	107.61
Arkhangel’sk	06	64.54	40.54
Belgorod	09	50.61	36.58
Kurgan	40	55.45	65.33
Kaluga	25	54.53	36.28
Krasnogvargeisky	66	59.97	30.48
Sochi	38	43.6	39.73
Orël	56	52.97	36.08
Volzhskiy	84	48.79	44.78
Smolensk	69	54.78	32.04
Murmansk	49	68.98	33.09
Vladikavkaz	68	43.04	44.67
Cherepovets	85	59.13	37.9
Vologda	85	59.22	39.88
Vladimir	83	56.14	40.4
Chita	93	52.03	113.5
Saransk	46	54.18	45.17
Surgut	32	61.25	73.42
Tambov	72	52.73	41.44
Yoshkar-Ola	45	56.64	47.89
Taganrog	61	47.24	38.9
Kostroma	37	57.77	40.93
Komsomolsk-on-Amur	30	50.55	137.01
Nal’chik	22	43.5	43.62
Sterlitamak	08	53.62	55.95
Petrozavodsk	28	61.78	34.35
Bratsk	20	56.13	101.61
Orsk	55	51.2	58.57
Nizhnevartovsk	32	60.93	76.55
Angarsk	20	52.54	103.89
Mar’ino	48	55.65	37.72
Novorossiysk	38	44.72	37.77
Khimki	47	55.9	37.43
Yakutsk	63	62.03	129.73
Nizhnekamsk	73	55.64	51.82
Dzerzhinsk	51	56.24	43.46
Syktyvkar	34	61.66	50.82
Staryy Oskol	09	51.3	37.84
Groznyy	12	43.31	45.69
Shakhty	61	47.71	40.21
Blagoveshchensk	05	50.28	127.54
Prokop’yevsk	29	53.91	86.72
Rybinsk	88	58.04	38.84
Vykhino-Zhulebino	48	55.7	37.81
Zelenograd	48	55.98	37.18
Biysk	04	52.54	85.21
Velikiy Novgorod	52	58.52	31.27
Centralniy	66	59.93	30.36
Vasyl'evsky Ostrov	66	59.94	30.25
Pskov	60	57.81	28.35
Severnyy	48	55.94	37.55
Balakovo	67	52.03	47.8
Armavir	38	44.99	41.12
Engel’s	67	51.48	46.11
Severodvinsk	06	64.56	39.83
Zlatoust	13	55.17	59.65
Syzran’	65	53.16	48.47
Petropavlovsk-Kamchatsky	92	53.04	158.65
Kamensk-Ural’skiy	71	56.42	61.93
Yasenevo	48	55.61	37.52
Podolsk	47	55.42	37.55
Yuzhno-Sakhalinsk	64	46.95	142.74
Lyublino	48	55.68	37.76
Berezniki	90	59.41	56.82
Volgodonsk	61	47.51	42.15
Miass	13	55.05	60.11
Abakan	31	53.72	91.43
Novocherkassk	61	47.42	40.09
Nazran’	19	43.23	44.77
Rubtsovsk	04	51.51	81.21
Mytishchi	47	55.91	37.73
Salavat	08	53.38	55.91
Khoroshëvo-Mnevniki	47	55.78	37.47
Bibirevo	48	55.88	37.6
Gol’yanovo	48	55.82	37.81
Admiralteisky	66	59.91	30.28
Ussuriysk	59	43.8	131.95
Lyubertsy	47	55.68	37.89
Kovrov	83	56.36	41.32
Strogino	48	55.82	37.41
Balashikha	47	55.81	37.96
Zhulebino	48	55.7	37.85
Kolomna	47	55.08	38.78
Nakhodka	59	42.81	132.87
Elektrostal’	47	55.79	38.45
Maykop	01	44.61	40.11
Biryulëvo	48	55.59	37.68
Orekhovo-Borisovo	48	55.61	37.73
Novyye Kuz’minki	48	55.7	37.75
Kuz’minki	48	55.7	37.8
Pyatigorsk	70	44.05	43.06
Chertanovo Yuzhnoye	48	55.59	37.6
Zheleznodorozhnyy	47	55.74	38.02
Norilsk	91	69.35	88.2
Al’met’yevsk	73	54.9	52.32
Korolev	47	55.91	37.83
Kolpino	66	59.75	30.59
Odintsovo	47	55.68	37.28
Nevinnomyssk	70	44.63	41.94
Pervoural’sk	71	56.91	59.94
Kislovodsk	70	43.91	42.72
Dimitrovgrad	81	54.21	49.62
Novomoskovsk	76	54.01	38.28
Petrogradka	66	59.97	30.31
Ramenki	48	55.7	37.5
Zyablikovo	48	55.62	37.77
Kamyshin	84	50.1	45.42
Novocheboksarsk	16	56.11	47.48
Serpukhov	47	54.92	37.41
Orekhovo-Borisovo Severnoye	48	55.62	37.68
Ivanovskoye	48	55.77	37.83
Murom	83	55.58	42.04
Khasavyurt	17	43.25	46.59
Neftekamsk	08	56.09	54.27
Tyoply Stan	48	55.62	37.49
Tsaritsyno	48	55.63	37.65
Veshnyaki	48	55.72	37.82
Presnenskiy	48	55.75	37.55
Zyuzino	48	55.66	37.57
Solntsevo	48	55.64	37.38
Orekhovo-Zuyevo	47	55.81	38.96
Troparëvo	48	55.66	37.48
Achinsk	91	56.27	90.5
Cherkessk	27	44.22	42.06
Taganskiy	48	55.73	37.67
Noginsk	47	55.87	38.44
Yelets	43	52.62	38.5
Novo-Peredelkino	48	55.65	37.34
Ochakovo-Matveyevskoye	48	55.68	37.45
Tobol’sk	78	58.2	68.25
Shchelkovo	47	55.92	37.97
Nefteyugansk	32	61.1	72.6
Novokuybyshevsk	65	53.1	49.95
Noyabrsk	87	63.19	75.44
Bataysk	61	47.14	39.75
Seversk	75	56.6	84.89
Arzamas	51	55.39	43.84
Sergiyev Posad	47	56.3	38.13
Leninsk-Kuznetsky	29	54.66	86.17
Kyzyl	79	51.71	94.45
Oktyabr’skiy	08	54.48	53.47
Obninsk	25	55.1	36.61
Elista	24	46.31	44.26
Cherëmushki	48	55.66	37.56
Novotroitsk	55	51.2	58.33
Derbent	17	42.07	48.29
Izmaylovo	47	55.79	37.8
Kiselëvsk	29	53.99	86.66
Akademicheskoe	42	60.01	30.39
Velikiye Luki	60	56.34	30.55
Bogorodskoye	48	55.81	37.72
Pushkino	47	56.02	37.87
Artëm	59	43.36	132.19
Ukhta	34	63.57	53.68
Shchukino	48	55.8	37.45
Brateyevo	48	55.64	37.76
Kansk	91	56.2	95.72
Mezhdurechensk	29	53.69	88.06
Ryazanskiy	48	55.73	37.77
Novyye Cherëmushki	48	55.7	37.58
Solikamsk	90	59.63	56.77
Glazov	80	58.14	52.66
Ust’-Ilimsk	20	58	102.66
Tekstil’shchiki	48	55.7	37.74
Zelenodolsk	73	55.84	48.52
Novoshakhtinsk	61	47.76	39.93
Sarapul	80	56.48	53.8
Votkinsk	80	57.05	53.99
Serov	71	59.6	60.58
Balashov	67	51.55	43.17
Zheleznogorsk	41	52.33	35.37
Zhukovskiy	47	55.6	38.12
Ramenskoye	47	55.57	38.23
Magadan	44	59.56	150.8
Ozerki	66	60.04	30.31
Novogireyevo	48	55.75	37.82
Vostochnoe Degunino	48	55.88	37.56
Novyy Urengoy	87	66.08	76.63
Novoural’sk	71	57.24	60.08
Zheleznogorsk	91	56.25	93.53
Michurinsk	72	52.9	40.49
Kineshma	21	57.44	42.13
Krasnogorsk	47	55.82	37.33
Pushkin	66	59.71	30.4
Bugul’ma	73	54.54	52.8
Yaroslavskiy	48	55.88	37.72
Lefortovo	48	55.77	37.7
Kuznetsk	57	53.12	46.6
Kirovo-Chepetsk	33	58.55	50.04
Berdsk	53	54.76	83.1
Gatchina	42	59.58	30.13
Biryulëvo Zapadnoye	47	55.59	37.64
Sarov	51	54.94	43.32
Yeysk	38	46.71	38.27
Buzuluk	55	52.78	52.26
Gubkin	09	51.28	37.55
Chaykovskiy	90	56.77	54.11
Lianozovo	48	55.9	37.59
Babushkin	48	55.87	37.73
Usol’ye-Sibirskoye	20	52.75	103.65
Svetlanovskiy	42	60	30.33
Yegor’yevsk	47	55.38	39.03
Yurga	29	55.72	84.89
Komendantsky aerodrom	66	60	30.28
Anzhero-Sudzhensk	29	56.08	86.03
Troitsk	13	54.1	61.58
Azov	61	47.11	39.42
Kaspiysk	17	42.88	47.64
Ozersk	13	55.76	60.7
Yessentuki	70	44.04	42.86
Klin	47	56.33	36.73
Vorkuta	34	67.5	64.05
Fili	47	55.75	37.48
Kropotkin	38	45.44	40.58
Shadrinsk	40	56.09	63.63
Vyborg	42	60.71	28.75
Reutov	47	55.76	37.86
Alekseyevka	47	55.63	37.8
Voskresensk	47	55.32	38.65
Mineralnye Vody	70	44.21	43.14
Birobidzhan	89	48.79	132.92
Nagornyy	48	55.65	37.62
Kamensk-Shakhtinskiy	61	48.32	40.26
Belovo	29	54.42	86.3
Chekhov	47	55.15	37.48
Asbest	71	57.01	61.46
Peterhof	66	59.88	29.9
Dachnoye	66	59.84	30.26
Minusinsk	91	53.71	91.69
Georgiyevsk	70	44.15	43.47
Yelabuga	73	55.76	52.06
Naro-Fominsk	47	55.39	36.73
Finlyandskiy	42	59.97	30.36
Sunzha	19	43.32	45.05
Chernogorsk	31	53.82	91.28
Zelenogorsk	91	56.11	94.6
Grazhdanka	66	60.04	30.41
Kopeysk	13	55.12	61.63
Kurortnyy	42	60.17	29.91
Vol’sk	67	52.05	47.38
Beloretsk	08	53.96	58.4
Ishimbay	08	53.45	56.04
Adler	38	43.43	39.92
Chapayevsk	65	52.98	49.71
Tuymazy	08	54.61	53.71
Lys’va	90	58.11	57.81
Borisoglebsk	86	51.37	42.08
Sosnovyy Bor	42	59.9	29.09
Dolgoprudnyy	47	55.95	37.5
Dorogomilovo	47	55.75	37.57
Budënnovsk	70	44.78	44.17
Belogorsk	05	50.92	128.48
Khanty-Mansiysk	32	61	69
Ishim	78	56.11	69.49
Kstovo	51	56.15	44.2
Aleksin	76	54.51	37.07
Parnas	42	60.07	30.35
Kungur	90	57.44	56.96
Klintsy	10	52.76	32.24
Neryungri	63	56.67	124.64
Leninogorsk	73	54.6	52.46
Sosnovka	66	60.02	30.35
Gukovo	61	48.06	39.94
Lesosibirsk	91	58.24	92.48
Polevskoy	71	56.44	60.19
Meleuz	08	52.96	55.93
Kumertau	08	52.77	55.78
Slavyansk-na-Kubani	38	45.26	38.13
Tikhoretsk	38	45.85	40.13
Rossosh’	86	51.12	38.51
Tuapse	38	44.11	39.08
Aleksandrov	83	56.4	38.71
Kotlovka	48	55.66	37.6
Zarechnyy	57	53.2	45.19
Pavlovo	51	55.97	43.09
Novaya Balakhna	51	56.49	43.6
Gus’-Khrustal’nyy	83	55.61	40.65
Buynaksk	17	42.82	47.12
Krasnotur’insk	71	59.77	60.21
Belebey	08	54.12	54.12
Rzhev	77	56.26	34.33
Chistopol’	73	55.36	50.64
Tikhvin	42	59.65	33.53
Petrodvorets	66	59.9	29.8
Labinsk	38	44.63	40.74
Iskitim	53	54.64	83.3
Revda	71	56.8	59.93
Lobnya	47	56.01	37.48
Vyksa	51	55.32	42.17
Dmitrov	47	56.34	37.52
Sibay	08	52.72	58.67
Apatity	49	67.56	33.4
Novoaltaysk	04	53.39	83.94
Svobodnyy	05	51.38	128.14
Sal’sk	61	46.47	41.54
Stupino	47	54.9	38.07
Prokhladnyy	22	43.76	44.03
Shuya	21	56.85	41.39
Shchëkino	76	54.01	37.52
Bor	51	56.36	44.07
Dubna	47	56.73	37.17
Pavlovskiy Posad	47	55.78	38.65
Sviblovo	48	55.85	37.63
Ostankinskiy	48	55.83	37.62
Mikhaylovsk	70	45.13	42.03
Kotlas	06	61.26	46.65
Verkhnyaya Pyshma	71	56.97	60.58
Talnakh	91	69.49	88.4
Mikhaylovka	84	50.06	43.24
Solnechnogorsk	47	56.18	36.98
Arsen’yev	59	44.15	133.28
Uzlovaya	76	53.98	38.17
Volzhsk	45	55.87	48.36
Kogalym	32	62.27	74.48
Krymsk	38	44.93	37.99
Cheremkhovo	20	53.16	103.07
Zhigulevsk	65	53.4	49.5
Sokol’niki	48	55.8	37.67
Sokol	48	55.8	37.52
Roslavl’	69	53.95	32.86
Borovichi	52	58.39	33.92
Chernaya Rechka	42	59.99	30.3
Kirishi	42	59.45	32.02
Ezhva	34	61.81	50.73
Liski	86	50.98	39.52
Vyaz’ma	69	55.21	34.3
Nazarovo	91	56.01	90.4
Klimovsk	47	55.36	37.53
Lesnoy	71	57.62	63.08
Rybatskoye	42	59.84	30.5
Uritsk	66	59.84	30.18
Zamoskvorech’ye	48	55.73	37.63
Pokrovskoye-Streshnëvo	48	55.81	37.46
Berëzovskiy	29	55.6	86.2
Gorno-Altaysk	03	51.96	85.92
Belorechensk	38	44.77	39.88
Krasnokamensk	93	50.1	118.04
Kupchino	66	59.85	30.36
Altuf’yevskiy	48	55.88	37.58
Timashëvsk	38	45.62	38.95
Severomorsk	49	69.07	33.42
Domodedovo	47	55.44	37.75
Vyshniy Volochëk	77	57.59	34.56
Anapa	38	44.89	37.32
Buguruslan	55	53.66	52.44
Fryazevo	47	55.73	38.46
Livny	56	52.43	37.61
Yartsevo	69	55.07	32.7
Krasnokamsk	90	58.08	55.76
Fryazino	47	55.96	38.05
Zarinsk	04	53.71	84.95
Nyagan	32	62.14	65.39
Kimry	77	56.87	37.35
Levoberezhnyy	47	55.85	37.48
Vidnoye	47	55.55	37.71
Tulun	20	54.56	100.58
Ivanteyevka	47	55.97	37.92
Donetsk	61	48.34	39.96
Gelendzhik	38	44.56	38.08
Lytkarino	47	55.58	37.91
Kingisepp	42	59.37	28.61
Kizlyar	17	43.85	46.71
Chusovoy	90	58.3	57.81
Otradnyy	65	53.38	51.35
Snezhinsk	13	56.09	60.73
Novovladykino	48	55.85	37.58
Vatutino	48	55.88	37.69
Vagonoremont	48	55.9	37.55
Semënovskoye	47	55.68	37.55
Novokuz’minki	48	55.72	37.78
Novokhovrino	48	55.87	37.5
Nikol’skoye	48	55.68	37.48
Likhobory	48	55.85	37.57
Kozhukhovo	47	55.7	37.67
Kozeyevo	48	55.87	37.62
Akademgorodok	53	54.85	83.11
Metrogorodok	48	55.81	37.79
Untolovo	42	60.01	30.21
#RW
Kigali	12	-1.95	30.06
Butare	15	-2.6	29.74
Gitarama	15	-2.07	29.76
Musanze	13	-1.5	29.63
Gisenyi	14	-1.7	29.26
Byumba	13	-1.58	30.07
Cyangugu	14	-2.48	28.91
#SA
Riyadh	10	24.69	46.72
Jeddah	14	21.49	39.19
Mecca	14	21.43	39.83
Medina	05	24.47	39.61
Sulţānah	05	24.49	39.59
Dammam	06	26.43	50.1
Ta’if	14	21.27	40.42
Tabuk	19	28.4	36.57
Al Kharj	10	24.16	47.33
Buraydah	08	26.33	43.97
Khamis Mushait	11	18.3	42.73
Al Hufūf	06	25.36	49.59
Al Mubarraz	06	25.41	49.59
Hafar Al-Batin	06	28.43	45.97
Ha'il	13	27.52	41.69
Najrān	16	17.49	44.13
Al Jubayl	06	27.02	49.62
Abha	11	18.22	42.51
Yanbu	05	24.09	38.06
Khobar	06	26.28	50.21
Arar	15	30.98	41.04
Sakakah	20	29.97	40.21
Jizan	17	16.89	42.55
Qurayyat	20	31.33	37.34
Dhahran	06	26.29	50.11
Al Qaţīf	06	26.57	50.01
Al Bahah	02	20.01	41.47
Tārūt	06	26.57	50.04
Qal‘at Bīshah	11	20	42.61
Ar Rass	08	25.87	43.5
Ash Shafā	14	21.07	40.32
Sayhāt	06	26.48	50.05
Al Mithnab	08	25.86	44.22
Al Khafjī	06	28.44	48.49
Ad Dawādimī	10	24.51	44.39
Şabyā	17	17.15	42.63
Az Zulfī	10	26.3	44.82
#SB
Honiara	14	-9.43	159.95
#SD
Khartoum	29	15.55	32.53
Omdurman	29	15.64	32.48
Nyala	49	12.05	24.88
Port Sudan	36	19.62	37.22
Kassala	52	15.45	36.4
El Obeid	56	13.18	30.22
Al Qadarif	39	14.03	35.38
Kosti	41	13.16	32.66
Wad Medani	38	14.4	33.52
El Daein	60	11.46	26.13
El Fasher	55	13.63	25.35
Singa	58	13.15	33.93
Ad-Damazin	42	11.79	34.36
Geneina	47	13.45	22.45
Rabak	41	13.18	32.74
Sinnar	58	13.57	33.57
Al Manāqil	38	14.25	32.99
Gereida	49	11.28	25.14
An Nuhūd	62	12.7	28.43
Atbara	53	17.7	33.99
Ed Damer	53	17.6	33.97
Kadugli	50	11.01	29.72
Ad Douiem	41	14	32.31
Umm Ruwaba	56	12.91	31.22
Shendi	53	16.69	33.43
#SE
Stockholm	26	59.33	18.07
Göteborg	28	57.71	11.97
Malmö	27	55.61	13
Uppsala	21	59.86	17.64
Sollentuna	26	59.43	17.95
Södermalm	26	59.31	18.08
Västerås	25	59.62	16.55
Örebro	15	59.27	15.21
Linköping	16	58.41	15.62
Helsingborg	27	56.05	12.69
Jönköping	08	57.78	14.16
Norrköping	16	58.59	16.18
Huddinge	26	59.24	17.98
Lund	27	55.71	13.19
Umeå	23	63.83	20.26
Haninge	26	59.17	18.14
Gävle	03	60.67	17.14
Borås	28	57.72	12.94
Södertälje	26	59.2	17.63
Kungsholmen	26	59.33	18.04
Eskilstuna	18	59.37	16.51
Solna	26	59.36	18
Halmstad	06	56.67	12.86
Växjö	12	56.88	14.81
Karlstad	22	59.38	13.5
Bromma	26	59.34	17.94
Mölndal	28	57.66	12.01
Vasastan	26	59.35	18.05
Täby	26	59.44	18.07
Sundsvall	24	62.39	17.31
#SG
Singapore	01	1.29	103.85
Woodlands	03	1.44	103.79
#SI
Ljubljana	61	46.05	14.51
Maribor	J2	46.55	15.65
#SK
Bratislava	02	48.15	17.11
Košice	03	48.71	21.26
Prešov	05	49	21.23
Nitra	04	48.31	18.08
Žilina	08	49.22	18.74
Banská Bystrica	01	48.74	19.15
Trnava	07	48.38	17.59
Trenčín	06	48.89	18.04
Poprad	05	49.06	20.3
Martin	08	49.07	18.92
Prievidza	06	48.77	18.63
#SL
Freetown	04	8.49	-13.24
Bo	03	7.96	-11.74
Kenema	01	7.88	-11.19
Koidu	01	8.64	-10.97
Makeni	02	8.89	-12.04
#SN
Dakar	01	14.69	-17.44
Pikine	01	14.76	-17.39
Touba	03	14.85	-15.88
Thiès	07	14.79	-16.93
Thiès Nones	07	14.78	-16.97
Saint-Louis	14	16.02	-16.49
Kaolack	10	14.15	-16.07
Ziguinchor	12	12.57	-16.27
Tiébo	03	14.63	-16.23
Tambacounda	05	13.77	-13.67
Mbaké	03	14.79	-15.91
Louga	13	15.62	-16.22
Kolda	11	12.89	-14.94
#SO
Mogadishu	02	2.04	45.34
Hargeysa	20	9.56	44.07
Berbera	20	10.44	45.01
Kismayo	09	-0.36	42.55
Marka	14	1.72	44.77
Jamaame	09	0.07	42.74
Baidoa	04	3.11	43.65
Burao	19	9.52	45.53
Bosaso	03	11.28	49.18
Afgooye	14	2.14	45.12
Gaalkacyo	10	6.77	47.43
Laascaanood	22	8.48	47.36
Garoowe	18	8.4	48.48
Beledweyne	07	4.74	45.2
Qoryooley	14	1.79	44.53
#SR
Paramaribo	16	5.87	-55.17
#SS
Juba	11550569	4.85	31.58
Winejok	11550582	9.01	27.57
Malakal	11550575	9.53	31.66
Wau	11550565	7.7	27.99
#ST
São Tomé	02	0.34	6.73
#SV
San Salvador	10	13.69	-89.19
Soyapango	10	13.71	-89.14
Santa Ana	11	13.99	-89.56
San Miguel	09	13.48	-88.18
Mejicanos	10	13.72	-89.19
Santa Tecla	05	13.68	-89.28
Apopa	10	13.81	-89.18
Delgado	10	13.72	-89.17
Sonsonate	13	13.72	-89.72
San Marcos	10	13.66	-89.18
Usulután	14	13.35	-88.45
#SY
Aleppo	09	36.2	37.16
Damascus	13	33.51	36.29
Homs	11	34.73	36.72
Ḩamāh	10	35.13	36.76
Latakia	02	35.53	35.79
Deir ez-Zor	07	35.34	40.14
Ar Raqqah	04	35.95	39.01
Al Bāb	09	36.37	37.52
Idlib	12	35.93	36.63
Douma	08	33.57	36.4
Manbij	09	36.53	37.95
Dar‘ā	06	32.62	36.1
As Salamīyah	10	35.01	37.05
Tartouss	14	34.89	35.89
Ath Thawrah	04	35.84	38.55
Al Ḩasakah	01	36.5	40.75
Dārayyā	08	33.46	36.23
I‘zāz	09	36.59	37.05
Jablah	02	35.36	35.93
As Safīrah	09	36.08	37.37
As-Suwayda	05	32.71	36.57
Ālbū Kamāl	07	34.45	40.92
At Tall	08	33.61	36.31
Al Mayādīn	07	35.02	40.45
Ar Rastan	11	34.93	36.73
Tadmur	11	34.56	38.28
‘Ayn al ‘Arab	09	36.89	38.35
#SZ
Manzini	03	-26.5	31.38
Mbabane	01	-26.32	31.13
#TD
N'Djamena	21	12.11	15.04
Moundou	08	8.57	16.08
Sarh	17	9.14	18.39
Abéché	12	13.83	20.83
#TG
Lomé	24	6.13	1.22
Sokodé	22	8.98	1.13
Kara	23	9.55	1.19
Atakpamé	25	7.53	1.13
Kpalimé	25	6.9	0.63
Bassar	23	9.25	0.78
Tsévié	24	6.43	1.21
#TH
Bangkok	40	13.75	100.5
Samut Prakan	42	13.6	100.6
Mueang Nonthaburi	38	13.86	100.51
Udon Thani	76	17.42	102.79
Chon Buri	46	13.36	100.98
Nakhon Ratchasima	27	14.97	102.1
Chiang Mai	02	18.79	98.98
Hat Yai	68	7.01	100.48
Pak Kret	38	13.91	100.5
Si Racha	46	13.17	100.93
Phra Pradaeng	42	13.66	100.53
Lampang	06	18.29	99.49
Khon Kaen	22	16.45	102.83
Surat Thani	60	9.14	99.33
Ubon Ratchathani	75	15.24	104.85
Nakhon Si Thammarat	64	8.43	99.97
Khlong Luang	39	14.06	100.65
Nakhon Pathom	53	13.82	100.04
Rayong	47	12.68	101.26
Phitsanulok	12	16.82	100.26
Chanthaburi	48	12.61	102.1
Pattaya	46	12.93	100.88
Yala	70	6.54	101.28
Ratchaburi	52	13.54	99.82
Nakhon Sawan	16	15.7	100.14
Phuket	62	7.89	98.4
Ban Mai	68	7.2	100.55
Songkhla	68	7.2	100.6
Phra Nakhon Si Ayutthaya	36	14.35	100.58
Chiang Rai	03	19.91	99.83
Bang Kruai	38	13.81	100.47
Sakon Nakhon	20	17.16	104.15
Krathum Baen	55	13.65	100.26
Saraburi	37	14.53	100.92
Trang	65	7.56	99.61
Sattahip	46	12.67	100.9
Kanchanaburi	50	14	99.55
Nong Khai	17	17.88	102.74
Samut Sakhon	55	13.55	100.27
Ban Lam Luk Ka	39	13.98	100.78
Kamphaeng Phet	11	16.48	99.52
Chaiyaphum	26	15.81	102.03
Uttaradit	10	17.63	100.09
Lop Buri	34	14.8	100.65
Ban Pong	52	13.82	99.88
Phra Phutthabat	37	14.73	100.8
Chumphon	58	10.5	99.18
Klaeng	47	12.78	101.65
Kalasin	23	16.43	103.51
Suphan Buri	51	14.47	100.12
Tha Maka	50	13.9	99.77
Ban Talat Yai	62	7.88	98.4
Maha Sarakham	24	16.18	103.3
Phetchabun	14	16.42	101.16
Hua Hin	57	12.57	99.96
Ko Samui	60	9.54	99.94
#TJ
Dushanbe	04	38.54	68.78
Khujand	03	40.28	69.62
Kŭlob	02	37.91	69.78
Qŭrghonteppa	02	37.83	68.78
Istaravshan	03	39.91	69
Konibodom	03	40.29	70.43
#TL
Dili	DI	-8.56	125.57
#TM
Ashgabat	S	37.95	58.38
Türkmenabat	04	39.07	63.58
Daşoguz	03	41.84	59.97
Mary	05	37.59	61.83
Balkanabat	02	39.51	54.37
Bayramaly	05	37.62	62.17
Türkmenbaşy	02	40.02	52.96
Tejen	01	37.38	60.51
#TN
Tunis	36	36.82	10.17
Sfax	32	34.74	10.76
Sousse	23	35.83	10.64
Kairouan	03	35.68	10.1
Bizerte	18	37.27	9.87
Gabès	29	33.88	10.1
Ariana	38	36.86	10.19
Kasserine	02	35.17	8.84
Gafsa	30	34.42	8.78
La Goulette	36	36.82	10.31
Zarzis	28	33.5	11.11
Ben Arous	27	36.75	10.22
Monastir	16	35.78	10.83
La Mohammedia	36	36.67	10.16
Al Marsá	36	36.88	10.32
Msaken	23	35.73	10.58
Skanes	16	35.78	10.8
Houmt El Souk	28	33.88	10.86
Tataouine	34	32.93	10.45
El Hamma	29	33.89	9.8
Medenine	28	33.35	10.51
Douane	19	36.45	10.76
Béja	17	36.73	9.18
Nabeul	19	36.46	10.74
Hammamet	19	36.4	10.62
Jendouba	06	36.5	8.78
#TR
Istanbul	34	41.01	28.95
Ankara	68	39.92	32.85
İzmir	35	38.41	27.14
Bursa	16	40.2	29.06
Adana	81	36.99	35.33
Gaziantep	83	37.06	37.38
Konya	71	37.87	32.48
Çankaya	68	39.92	32.86
Antalya	07	36.91	30.7
Bağcılar	34	41.04	28.86
Diyarbakır	21	37.91	40.22
Kayseri	38	38.73	35.49
Üsküdar	34	41.02	29.01
Bahçelievler	34	41	28.86
Umraniye	34	41.02	29.12
Mersin	32	36.81	34.64
Esenler	34	41.04	28.88
Eskişehir	26	39.78	30.52
Karabağlar	35	38.37	27.14
Muratpaşa	07	36.89	30.76
Şanlıurfa	63	37.17	38.79
Malatya	44	38.35	38.32
Sultangazi	34	41.11	28.87
Maltepe	34	40.94	29.16
Erzurum	25	39.91	41.28
Samsun	55	41.28	36.34
Batman	76	37.89	41.13
Kahramanmaraş	46	37.58	36.93
Van	65	38.49	43.38
Ataşehir	34	40.98	29.12
Şişli	34	41.06	28.99
Denizli	20	37.77	29.09
Batikent	68	39.97	32.73
Elazığ	23	38.67	39.22
Zeytinburnu	34	40.99	28.9
Adapazarı	54	40.78	30.4
Sultanbeyli	34	40.96	29.27
Gebze	41	40.8	29.43
Merkezefendi	20	37.81	29.04
Sivas	58	39.75	37.02
Tarsus	32	36.92	34.89
Trabzon	61	41.01	39.73
Manisa	45	38.61	27.43
Sancaktepe	34	41	29.23
Balıkesir	10	39.65	27.89
Adıyaman	02	37.76	38.28
Esenyurt	34	41.03	28.68
Kırıkkale	79	39.85	33.51
Antakya	31	36.21	36.16
Osmaniye	91	37.07	36.25
Çorlu	59	41.16	27.8
Arnavutköy	34	41.18	28.74
İzmit	41	40.76	29.93
Başakşehir	34	41.09	28.8
Kütahya	43	39.42	29.98
Çorum	19	40.55	34.95
Siverek	63	37.76	39.32
Isparta	33	37.76	30.55
Büyükçekmece	34	41.02	28.59
Aydın	09	37.85	27.84
İskenderun	31	36.59	36.17
Viranşehir	63	37.22	39.76
Uşak	64	38.67	29.41
Aksaray	75	38.37	34.03
Kızıltepe	72	37.19	40.58
Afyonkarahisar	03	38.76	30.54
İnegol	16	40.08	29.51
Tokat	60	40.31	36.55
Edirne	22	41.68	26.56
Derince	41	40.76	29.81
Beylikdüzü	34	40.98	28.64
Tekirdağ	59	40.98	27.51
Karaman	78	37.18	33.22
Nazilli	09	37.92	28.32
Ordu	52	40.98	37.89
Siirt	74	37.93	41.94
Erzincan	24	39.74	39.49
Alanya	07	36.54	32
Turhal	60	40.39	36.08
Bandırma	10	40.35	27.98
Turgutlu	45	38.5	27.7
Mustafakemalpaşa	16	40.04	28.41
Zonguldak	85	41.45	31.79
Manavgat	07	36.79	31.44
Giresun	28	40.92	38.39
Karabük	89	41.2	32.63
Bolu	14	40.74	31.61
Ceyhan	81	37.02	35.82
Kırşehir	40	39.15	34.16
Polatlı	68	39.58	32.14
Bafra	55	41.57	35.91
Rize	53	41.02	40.52
Ereğli	71	37.51	34.05
Ağrı	04	39.72	43.05
Erciş	65	39.03	43.36
Niğde	73	37.97	34.68
Lüleburgaz	39	41.4	27.36
Körfez	41	40.77	29.78
Nusaybin	72	37.07	41.21
Salihli	45	38.48	28.15
Ereğli	85	41.28	31.42
Kozan	81	37.46	35.82
Yozgat	66	39.82	34.8
Çanakkale	17	40.16	26.41
Patnos	04	39.22	42.86
Akhisar	45	38.92	27.84
Çerkezköy	59	41.29	28
Amasya	05	40.65	35.83
Muş	49	38.73	41.48
Nizip	83	37.01	37.79
Kilis	90	36.72	37.12
Fatsa	52	41.03	37.5
Cizre	80	37.33	42.18
Bingöl	12	38.88	40.49
Elbistan	46	38.21	37.2
Hakkâri	70	37.57	43.74
Ünye	52	41.13	37.28
Kars	84	40.6	43.09
Midyat	72	37.42	41.34
Iğdır	88	39.92	44.05
Nevşehir	50	38.63	34.71
Silifke	32	36.38	33.93
Silopi	80	37.24	42.46
Bismil	21	37.85	40.66
Belek	07	36.86	31.06
Tatvan	13	38.49	42.28
Kâhta	02	37.79	38.62
Yüksekova	70	37.57	44.29
Khanjarah	82	40.6	33.62
Mardin	72	37.31	40.74
Yalova	92	40.66	29.28
Gemlik	16	40.43	29.16
Kastamonu	37	41.38	33.78
Kadirli	91	37.37	36.1
Doğubayazıt	04	39.55	44.08
Ayvalık	10	39.32	26.69
Söke	09	37.75	27.41
Ardeşen	53	41.19	40.99
Ödemiş	35	38.23	27.97
Burdur	15	37.72	30.29
Silvan	21	38.14	41.01
Soma	45	39.19	27.61
Ahlat	13	38.75	42.48
Akşehir	71	38.36	31.42
Kuşadası	09	37.86	27.26
Sorgun	66	39.81	35.19
Çubuk	68	40.24	33.03
Kırıkhan	31	36.5	36.36
Fethiye	48	36.64	29.13
Kırklareli	39	41.74	27.23
Düzce	93	40.84	31.16
Bergama	35	39.12	27.18
Anamur	32	36.08	32.84
Reyhanlı	31	36.27	36.57
Dörtyol	31	36.84	36.23
Gölcük	41	40.7	29.87
Bolvadin	03	38.71	31.05
Zile	60	40.3	35.89
Eminönü	34	41.02	28.97
Bozüyük	11	39.91	30.04
Menemen	35	38.61	27.07
Silivri	34	41.07	28.25
Adilcevaz	13	38.8	42.73
Şırnak	80	37.51	42.45
Ergani	21	38.27	39.75
Erbaa	60	40.67	36.57
Tavşanlı	43	39.54	29.5
Orhangazi	16	40.49	29.31
Seydişehir	71	37.42	31.85
Merzifon	05	40.87	35.46
Kavaklı	34	41.09	28.33
Çarşamba	55	41.2	36.72
Torbalı	35	38.15	27.36
Merter Keresteciler	34	41.01	28.89
güngören merter	34	41.01	28.89
#TT
Chaguanas	CHA	10.52	-61.42
Mon Repos	10	10.28	-61.45
San Fernando	10	10.28	-61.47
#TW
Taipei	04	25.05	121.53
Kaohsiung	02	22.62	120.31
Taichung	04	24.15	120.68
Tainan	04	22.99	120.21
Banqiao	03	25.01	121.47
Hsinchu	04	24.8	120.97
Taoyuan City	04	24.99	121.3
Keelung	04	25.13	121.74
Hualien City	04	23.98	121.6
Yuanlin	04	23.96	120.58
Taitung City	04	22.76	121.14
Nantou	04	23.92	120.66
Douliu	04	23.71	120.54
Yilan	04	24.76	121.75
Puli	04	23.97	120.97
Daxi	04	24.88	121.29
Magong	04	23.57	119.59
#TZ
Dar es Salaam	23	-6.82	39.27
Mwanza	12	-2.52	32.9
Zanzibar	25	-6.16	39.2
Arusha	26	-3.37	36.68
Mbeya	09	-8.9	33.45
Morogoro	10	-6.82	37.66
Tanga	18	-5.07	39.1
Dodoma	03	-6.17	35.74
Kigoma	05	-4.88	29.63
Moshi	06	-3.35	37.33
Tabora	17	-5.02	32.83
Songea	14	-10.68	35.65
Musoma	08	-1.5	33.8
Iringa	04	-7.77	35.7
Katumba	09	-9.23	33.62
Shinyanga	15	-3.66	33.42
Mtwara	11	-10.27	40.18
Ushirombo	28	-3.49	31.96
Kilosa	10	-6.83	36.98
Sumbawanga	24	-7.97	31.62
Bagamoyo	02	-6.44	38.9
Mpanda	29	-6.34	31.07
Bukoba	19	-1.33	31.81
Singida	16	-4.82	34.74
Uyovu	28	-3.28	31.53
Makumbako	30	-8.85	34.83
Buseresere	28	-3.02	31.87
Bunda	08	-2.05	33.87
Merelani	26	-3.56	36.98
#UA
Kyiv	12	50.45	30.52
Kharkiv	07	49.98	36.25
Dnipro	04	48.46	35.04
Donetsk	05	48.02	37.8
Odessa	17	46.48	30.73
Zaporizhia	26	47.82	35.19
Lviv	15	49.84	24.02
Kryvyi Rih	04	47.91	33.38
Mykolayiv	16	46.97	32
Mariupol	05	47.1	37.54
Luhansk	14	48.57	39.32
Sevastopol	20	44.61	33.52
Khmelnytskyi	09	49.42	27
Makiyivka	05	48.05	37.93
Vinnytsia	23	49.23	28.48
Simferopol	11	44.96	34.11
Kherson	08	46.66	32.62
Poltava	18	49.59	34.54
Chernihiv	02	51.51	31.28
Cherkasy	01	49.43	32.06
Sumy	21	50.92	34.8
Zhytomyr	27	50.26	28.68
Horlivka	05	48.34	38.05
Rivne	19	50.62	26.23
Kropyvnytskyi	10	48.51	32.26
Kamianske	04	48.51	34.6
Chernivtsi	03	48.29	25.94
Ternopil	22	49.55	25.59
Kremenchuk	18	49.07	33.42
Lutsk	24	50.76	25.34
Ivano-Frankivsk	06	48.92	24.71
Bila Tserkva	13	49.81	30.11
Kramators’k	05	48.72	37.56
Melitopol	26	46.85	35.37
Kerch	11	45.36	36.48
Nikopol	04	47.57	34.4
Syevyerodonets’k	14	48.95	38.49
Sloviansk	05	48.87	37.62
Berdyansk	26	46.77	36.8
Uzhgorod	25	48.62	22.3
Alchevs’k	14	48.47	38.82
Pavlohrad	04	48.53	35.87
Lysychans’k	14	48.9	38.44
Yevpatoriya	11	45.2	33.37
Yenakiyeve	05	48.23	38.21
Oleksandriya	10	48.67	33.12
Kamianets-Podilskyi	09	48.68	26.59
Konotop	21	51.24	33.2
Kostyantynivka	05	48.53	37.71
Krasnyy Luch	14	48.14	38.94
Brovary	13	50.52	30.81
Uman	01	48.75	30.22
Berdychiv	27	49.9	28.6
Shostka	21	51.86	33.47
Kadiyivka	14	48.57	38.64
Chervonohrad	15	50.39	24.24
Mukacheve	25	48.44	22.72
Bakhmut	05	48.59	38
Drohobych	15	49.35	23.51
Yalta	11	44.5	34.17
Nizhyn	02	51.05	31.89
Novomoskovs’k	04	48.64	35.25
Izmail	17	45.35	28.84
Shakhtars’k	05	48.06	38.44
Pervomays’k	16	48.04	30.85
Feodosiya	11	45.03	35.38
Pokrovsk	05	48.28	37.18
Chystyakove	05	48.04	38.6
Sverdlovs’k	14	48.09	39.65
Kalush	06	49.01	24.37
Smila	01	49.22	31.89
Kovel	24	51.22	24.71
Korosten’	27	50.96	28.64
Khartsyz’k	05	48.04	38.15
Rubizhne	14	49.01	38.38
Pryluky	02	50.59	32.39
Druzhkivka	05	48.63	37.55
Lozova	07	48.89	36.32
Kolomyia	06	48.53	25.04
Antratsyt	14	48.12	39.09
Stryi	15	49.26	23.86
Novovolyns’k	24	50.73	24.16
Novohrad-Volynskyi	27	50.59	27.62
Energodar	26	47.5	34.66
Snizhne	05	48.03	38.77
Boryspil’	13	50.35	30.96
Chornomors’k	17	46.3	30.65
Izyum	07	49.21	37.25
Roven’ky	14	48.08	39.38
Lubny	18	50.02	33
Bryanka	14	48.51	38.67
Horishni Plavni	18	49.01	33.64
Zhovti Vody	04	48.34	33.5
Fastiv	13	50.08	29.92
Nova Kakhovka	08	46.75	33.35
Marhanets’	04	47.64	34.63
Bilhorod-Dnistrovskyi	17	46.19	30.35
#UG
Kampala	C	0.32	32.58
Gulu	N	2.77	32.3
Lira	N	2.25	32.9
Mbarara	W	-0.6	30.65
Jinja	E	0.44	33.2
Bwizibwera	W	-0.59	30.63
Mbale	E	1.08	34.18
Mukono	C	0.35	32.76
Kasese	W	0.18	30.08
Masaka	C	-0.33	31.73
Entebbe	C	0.06	32.48
Njeru	C	0.44	33.18
Kitgum	N	3.28	32.89
Soroti	E	1.71	33.61
Arua	N	3.02	30.91
#US
New York City	NY	40.71	-74.01
Los Angeles	CA	34.05	-118.24
Chicago	IL	41.85	-87.65
Brooklyn	NY	40.65	-73.95
Houston	TX	29.76	-95.36
Queens	NY	40.68	-73.84
Philadelphia	PA	39.95	-75.16
Phoenix	AZ	33.45	-112.07
Manhattan	NY	40.78	-73.97
San Antonio	TX	29.42	-98.49
San Diego	CA	32.72	-117.16
The Bronx	NY	40.85	-73.87
Dallas	TX	32.78	-96.81
San Jose	CA	37.34	-121.89
Austin	TX	30.27	-97.74
Jacksonville	FL	30.33	-81.66
San Francisco	CA	37.77	-122.42
Columbus	OH	39.96	-83
Fort Worth	TX	32.73	-97.32
Indianapolis	IN	39.77	-86.16
Charlotte	NC	35.23	-80.84
Seattle	WA	47.61	-122.33
Denver	CO	39.74	-104.98
El Paso	TX	31.76	-106.49
Detroit	MI	42.33	-83.05
Boston	MA	42.36	-71.06
Memphis	TN	35.15	-90.05
New South Memphis	TN	35.09	-90.06
Portland	OR	45.52	-122.68
Oklahoma City	OK	35.47	-97.52
Las Vegas	NV	36.17	-115.14
Baltimore	MD	39.29	-76.61
Washington, D.C.	DC	38.9	-77.04
Milwaukee	WI	43.04	-87.91
South Boston	MA	42.33	-71.05
Albuquerque	NM	35.08	-106.65
Tucson	AZ	32.22	-110.93
Nashville	TN	36.17	-86.78
Fresno	CA	36.75	-119.77
Sacramento	CA	38.58	-121.49
Kansas City	MO	39.1	-94.58
Long Beach	CA	33.77	-118.19
Mesa	AZ	33.42	-111.82
Staten Island	NY	40.56	-74.14
Atlanta	GA	33.75	-84.39
Colorado Springs	CO	38.83	-104.82
Virginia Beach	VA	36.85	-75.98
Raleigh	NC	35.77	-78.64
Omaha	NE	41.26	-95.94
Miami	FL	25.77	-80.19
Oakland	CA	37.8	-122.27
Minneapolis	MN	44.98	-93.26
Tulsa	OK	36.15	-95.99
Wichita	KS	37.69	-97.34
New Orleans	LA	29.95	-90.08
Arlington	TX	32.74	-97.11
Cleveland	OH	41.5	-81.7
Bakersfield	CA	35.37	-119.02
Honolulu	HI	21.31	-157.86
Tampa	FL	27.95	-82.46
Aurora	CO	39.73	-104.83
Anaheim	CA	33.84	-117.91
West Raleigh	NC	35.79	-78.66
Santa Ana	CA	33.75	-117.87
Corpus Christi	TX	27.8	-97.4
Riverside	CA	33.95	-117.4
St. Louis	MO	38.63	-90.2
Lexington-Fayette	KY	38.05	-84.46
Stockton	CA	37.96	-121.29
Pittsburgh	PA	40.44	-80
Anchorage	AK	61.22	-149.9
Cincinnati	OH	39.13	-84.51
Ironville	KY	38.46	-82.69
Meads	KY	38.41	-82.71
Henderson	NV	36.04	-114.98
Greensboro	NC	36.07	-79.79
Saint Paul	MN	44.94	-93.09
Plano	TX	33.02	-96.7
Newark	NJ	40.74	-74.17
Toledo	OH	41.66	-83.56
Lincoln	NE	40.8	-96.67
Orlando	FL	28.54	-81.38
Chula Vista	CA	32.64	-117.08
Jersey City	NJ	40.73	-74.08
Chandler	AZ	33.31	-111.84
Fort Wayne	IN	41.13	-85.13
Buffalo	NY	42.89	-78.88
Durham	NC	35.99	-78.9
St. Petersburg	FL	27.77	-82.68
Irvine	CA	33.67	-117.82
Laredo	TX	27.51	-99.51
Lubbock	TX	33.58	-101.86
Madison	WI	43.07	-89.4
Gilbert	AZ	33.35	-111.79
Norfolk	VA	36.85	-76.29
Louisville	KY	38.25	-85.76
Reno	NV	39.53	-119.81
Winston-Salem	NC	36.1	-80.24
Glendale	AZ	33.54	-112.19
Hialeah	FL	25.86	-80.28
Garland	TX	32.91	-96.64
Scottsdale	AZ	33.51	-111.9
Irving	TX	32.81	-96.95
Chesapeake	VA	36.82	-76.27
North Las Vegas	NV	36.2	-115.12
Fremont	CA	37.55	-121.99
Baton Rouge	LA	30.44	-91.19
Lexington	KY	37.99	-84.48
Paradise	NV	36.1	-115.15
Richmond	VA	37.55	-77.46
Jamaica	NY	40.69	-73.81
San Bernardino	CA	34.11	-117.29
Spokane	WA	47.66	-117.43
Birmingham	AL	33.52	-86.8
Modesto	CA	37.64	-121
Des Moines	IA	41.6	-93.61
Rochester	NY	43.15	-77.62
Maryvale	AZ	33.5	-112.18
Tacoma	WA	47.25	-122.44
Arlington	VA	38.88	-77.1
Fontana	CA	34.09	-117.44
Oxnard	CA	34.2	-119.18
Moreno Valley	CA	33.94	-117.23
Fayetteville	NC	35.05	-78.88
Huntington Beach	CA	33.66	-118
Yonkers	NY	40.93	-73.9
Glendale	CA	34.14	-118.26
Aurora	IL	41.76	-88.32
Montgomery	AL	32.37	-86.3
Columbus	GA	32.46	-84.99
Amarillo	TX	35.22	-101.83
Little Rock	AR	34.75	-92.29
Akron	OH	41.08	-81.52
Shreveport	LA	32.53	-93.75
Grand Rapids	MI	42.96	-85.67
Mobile	AL	30.69	-88.04
Salt Lake City	UT	40.76	-111.89
Huntsville	AL	34.73	-86.59
Tallahassee	FL	30.44	-84.28
Sunrise Manor	NV	36.21	-115.07
Grand Prairie	TX	32.75	-97
Overland Park	KS	38.98	-94.67
Knoxville	TN	35.96	-83.92
Worcester	MA	42.26	-71.8
Brownsville	TX	25.9	-97.5
Newport News	VA	37.08	-76.47
Santa Clarita	CA	34.39	-118.54
Providence	RI	41.82	-71.41
Fort Lauderdale	FL	26.12	-80.14
East Flatbush	NY	40.65	-73.93
Spring Valley	NV	36.11	-115.24
Chattanooga	TN	35.05	-85.31
Tempe	AZ	33.41	-111.91
Oceanside	CA	33.2	-117.38
Garden Grove	CA	33.77	-117.94
Rancho Cucamonga	CA	34.11	-117.59
Cape Coral	FL	26.56	-81.95
Santa Rosa	CA	38.44	-122.71
East New York	NY	40.67	-73.88
Vancouver	WA	45.64	-122.66
Sioux Falls	SD	43.55	-96.7
Peoria	AZ	33.58	-112.24
Ontario	CA	34.06	-117.65
Jackson	MS	32.3	-90.18
Hollywood	CA	34.1	-118.33
Elk Grove	CA	38.41	-121.37
Springfield	MO	37.22	-93.3
Pembroke Pines	FL	26	-80.22
Deer Valley	AZ	33.68	-112.13
Port Saint Lucie	FL	27.29	-80.35
Salem	OR	44.94	-123.04
Corona	CA	33.88	-117.57
Eugene	OR	44.05	-123.09
McKinney	TX	33.2	-96.62
Fort Collins	CO	40.59	-105.08
Lancaster	CA	34.7	-118.14
Cary	NC	35.79	-78.78
Tempe Junction	AZ	33.41	-111.94
Palmdale	CA	34.58	-118.12
Hayward	CA	37.67	-122.08
Salinas	CA	36.68	-121.66
Frisco	TX	33.15	-96.82
Springfield	MA	42.1	-72.59
East Chattanooga	TN	35.07	-85.25
Pasadena	TX	29.69	-95.21
Alexandria	VA	38.8	-77.05
Pomona	CA	34.06	-117.75
Washington Heights	NY	40.85	-73.94
Lakewood	CO	39.7	-105.08
Sunnyvale	CA	37.37	-122.04
Escondido	CA	33.12	-117.09
Kansas City	KS	39.11	-94.63
Astoria	NY	40.77	-73.93
Hollywood	FL	26.01	-80.15
Borough Park	NY	40.63	-74
Clarksville	TN	36.53	-87.36
Torrance	CA	33.84	-118.34
Valencia	CA	34.44	-118.61
Rockford	IL	42.27	-89.09
East Hampton	VA	37.04	-76.33
Joliet	IL	41.53	-88.08
Paterson	NJ	40.92	-74.17
Bridgeport	CT	41.18	-73.19
Naperville	IL	41.79	-88.15
Boise	ID	43.61	-116.2
Savannah	GA	32.08	-81.1
Mesquite	TX	32.77	-96.6
Syracuse	NY	43.05	-76.15
Metairie Terrace	LA	29.98	-90.16
Pasadena	CA	34.15	-118.14
Orange	CA	33.79	-117.85
Fullerton	CA	33.87	-117.93
Killeen	TX	31.12	-97.73
Dayton	OH	39.76	-84.19
McAllen	TX	26.2	-98.23
Bellevue	WA	47.61	-122.2
Metairie	LA	29.98	-90.15
Miramar	FL	25.99	-80.23
Hampton	VA	37.03	-76.35
Van Nuys	CA	34.19	-118.45
West Valley City	UT	40.69	-112
Olathe	KS	38.88	-94.82
Warren	MI	42.49	-83.01
Columbia	SC	34	-81.03
Thornton	CO	39.87	-104.97
Carrollton	TX	32.95	-96.89
Midland	TX	32	-102.08
Charleston	SC	32.78	-79.93
Waco	TX	31.55	-97.15
Sterling Heights	MI	42.58	-83.03
Denton	TX	33.21	-97.13
Cedar Rapids	IA	42.01	-91.64
New Haven	CT	41.31	-72.93
Roseville	CA	38.75	-121.29
Gainesville	FL	29.65	-82.32
Visalia	CA	36.33	-119.29
Coral Springs	FL	26.27	-80.27
Thousand Oaks	CA	34.17	-118.84
Elizabeth	NJ	40.66	-74.21
Stamford	CT	41.05	-73.54
Concord	CA	37.98	-122.03
Surprise	AZ	33.63	-112.33
Alhambra	AZ	33.5	-112.13
Lafayette	LA	30.22	-92.02
Topeka	KS	39.05	-95.68
Kent	WA	47.38	-122.23
Simi Valley	CA	34.27	-118.78
East Los Angeles	CA	34.02	-118.17
Santa Clara	CA	37.35	-121.96
Murfreesboro	TN	35.85	-86.39
Sunset Park	NY	40.65	-74.01
Koreatown	CA	34.06	-118.3
Hartford	CT	41.76	-72.69
Sheepshead Bay	NY	40.59	-73.94
Amherst	NY	42.98	-78.8
Victorville	CA	34.54	-117.29
Abilene	TX	32.45	-99.73
Vallejo	CA	38.1	-122.26
North Stamford	CT	41.14	-73.54
Berkeley	CA	37.87	-122.27
Norman	OK	35.22	-97.44
Allentown	PA	40.61	-75.49
Evansville	IN	37.97	-87.56
Columbia	MO	38.95	-92.33
Odessa	TX	31.85	-102.37
Fargo	ND	46.88	-96.79
Beaumont	TX	30.09	-94.1
Independence	MO	39.09	-94.42
Ann Arbor	MI	42.28	-83.74
El Monte	CA	34.07	-118.03
Athens	GA	33.96	-83.38
Springfield	IL	39.8	-89.64
Harlem	NY	40.81	-73.95
Round Rock	TX	30.51	-97.68
Wilmington	NC	34.23	-77.94
East Harlem	NY	40.79	-73.94
Arvada	CO	39.8	-105.09
Provo	UT	40.23	-111.66
Peoria	IL	40.69	-89.59
Lansing	MI	42.73	-84.56
Downey	CA	33.94	-118.13
Carlsbad	CA	33.16	-117.35
Elmhurst	NY	40.74	-73.88
Costa Mesa	CA	33.64	-117.92
Miami Gardens	FL	25.94	-80.25
Westminster	CO	39.84	-105.04
North Peoria	IL	40.72	-89.58
Clearwater	FL	27.97	-82.8
Fairfield	CA	38.25	-122.04
Bushwick	NY	40.69	-73.92
Gravesend	NY	40.6	-73.97
Rochester	MN	44.02	-92.47
Elgin	IL	42.04	-88.28
Temecula	CA	33.49	-117.15
West Jordan	UT	40.61	-111.94
Inglewood	CA	33.96	-118.35
Richardson	TX	32.95	-96.73
Lowell	MA	42.63	-71.32
East Independence	MO	39.1	-94.36
Gresham	OR	45.5	-122.43
Antioch	CA	38	-121.81
Cambridge	MA	42.38	-71.11
High Point	NC	35.96	-80.01
Billings	MT	45.78	-108.5
Manchester	NH	43	-71.45
Murrieta	CA	33.55	-117.21
Centennial	CO	39.58	-104.88
Richmond	CA	37.94	-122.35
Corona	NY	40.75	-73.86
Pueblo	CO	38.25	-104.61
Pearland	TX	29.56	-95.29
Waterbury	CT	41.56	-73.05
West Covina	CA	34.07	-117.94
Enterprise	NV	36.03	-115.24
North Charleston	SC	32.85	-79.97
Everett	WA	47.98	-122.2
College Station	TX	30.63	-96.33
Palm Bay	FL	28.03	-80.59
Pompano Beach	FL	26.24	-80.12
Boulder	CO	40.01	-105.27
Norwalk	CA	33.9	-118.08
West Palm Beach	FL	26.72	-80.05
Broken Arrow	OK	36.05	-95.79
Daly City	CA	37.71	-122.46
Sandy Springs	GA	33.92	-84.38
Burbank	CA	34.18	-118.31
Green Bay	WI	44.52	-88.02
Santa Maria	CA	34.95	-120.44
Universal City	CA	34.14	-118.35
Wichita Falls	TX	33.91	-98.49
Lakeland	FL	28.04	-81.95
Clovis	CA	36.83	-119.7
Lewisville	TX	33.05	-96.99
Tyler	TX	32.35	-95.3
El Cajon	CA	32.79	-116.96
San Mateo	CA	37.56	-122.33
Brandon	FL	27.94	-82.29
Rialto	CA	34.11	-117.37
Davenport	IA	41.52	-90.58
Edison	NJ	40.52	-74.41
Hillsboro	OR	45.52	-122.99
Las Cruces	NM	32.31	-106.78
South Bend	IN	41.68	-86.25
Vista	CA	33.2	-117.24
Greeley	CO	40.42	-104.71
Davie	FL	26.06	-80.23
Chinatown	CA	37.8	-122.41
San Angelo	TX	31.46	-100.44
Renton	WA	47.48	-122.22
Roanoke	VA	37.27	-79.94
Kenosha	WI	42.58	-87.82
Clinton Township	MI	42.59	-82.92
Columbia	MD	39.24	-76.84
Erie	PA	42.13	-80.09
Portsmouth Heights	VA	36.82	-76.37
Richmond Hill	NY	40.7	-73.83
Alief	TX	29.71	-95.6
Spring Hill	FL	28.48	-82.53
Albany	NY	42.65	-73.76
Compton	CA	33.9	-118.22
Tuscaloosa	AL	33.21	-87.57
League City	TX	29.51	-95.09
Flint	MI	43.01	-83.69
Allen	TX	33.1	-96.67
Mission Viejo	CA	33.6	-117.67
Vacaville	CA	38.36	-121.99
Ventura	CA	34.28	-119.29
Highlands Ranch	CO	39.55	-104.97
Lawton	OK	34.61	-98.39
Beaverton	OR	45.49	-122.8
South Gate	CA	33.95	-118.21
Portsmouth	VA	36.84	-76.3
Sparks	NV	39.53	-119.75
Brockton	MA	42.08	-71.02
Dearborn	MI	42.32	-83.18
Federal Way	WA	47.32	-122.31
Lee's Summit	MO	38.91	-94.38
New Bedford	MA	41.64	-70.93
Spokane Valley	WA	47.67	-117.24
Fordham	NY	40.86	-73.9
Livonia	MI	42.37	-83.35
Roswell	GA	34.02	-84.36
Orem	UT	40.3	-111.69
Yuma	AZ	32.73	-114.62
Lawrence	KS	38.97	-95.24
The Woodlands	TX	30.16	-95.49
West Albany	NY	42.68	-73.78
Yakima	WA	46.6	-120.51
Quincy	MA	42.25	-71
Flatbush	NY	40.65	-73.96
Hesperia	CA	34.43	-117.3
Carson	CA	33.83	-118.28
Boca Raton	FL	26.36	-80.08
Santa Monica	CA	34.02	-118.49
San Marcos	CA	33.14	-117.17
Boyle Heights	CA	34.03	-118.21
Plantation	FL	26.13	-80.23
Lynn	MA	42.47	-70.95
Miami Beach	FL	25.79	-80.13
Arden-Arcade	CA	38.6	-121.38
Westminster	CA	33.76	-118.01
Longmont	CO	40.17	-105.1
Santa Barbara	CA	34.42	-119.7
Redding	CA	40.59	-122.39
Macon	GA	32.84	-83.63
Meridian	ID	43.61	-116.39
San Leandro	CA	37.72	-122.16
Greenville	NC	35.61	-77.37
Chico	CA	39.73	-121.84
Edmond	OK	35.65	-97.48
Chinatown	NY	40.72	-74
Nampa	ID	43.54	-116.56
Sandy Hills	UT	40.58	-111.85
Newton	MA	42.34	-71.21
Toms River	NJ	39.95	-74.2
Fall River	MA	41.7	-71.16
Carmel	IN	39.98	-86.12
Asheville	NC	35.6	-82.55
Norwalk	CT	41.12	-73.41
Waukegan	IL	42.36	-87.84
Deltona	FL	28.9	-81.26
Hawthorne	CA	33.92	-118.35
Fort Smith	AR	35.39	-94.4
Suffolk	VA	36.73	-76.58
Sugar Land	TX	29.62	-95.63
Livermore	CA	37.68	-121.77
Nashua	NH	42.77	-71.47
Reading	PA	40.34	-75.93
Concord	NC	35.41	-80.58
Indio	CA	33.72	-116.22
Rio Rancho	NM	35.23	-106.66
Enchanted Hills	NM	35.34	-106.59
Sandy	UT	40.59	-111.88
Whittier	CA	33.98	-118.03
Canarsie	NY	40.64	-73.9
Kirkland	WA	47.68	-122.21
Menifee	CA	33.73	-117.15
Newport Beach	CA	33.62	-117.93
Tracy	CA	37.74	-121.43
Citrus Heights	CA	38.71	-121.28
Bend	OR	44.06	-121.32
Canton	MI	42.31	-83.48
Lehigh Acres	FL	26.63	-81.62
Greenburgh	NY	41.03	-73.84
Bloomington	MN	44.84	-93.3
West Town	IL	41.89	-87.67
Germantown	MD	39.17	-77.27
Clifton	NJ	40.86	-74.16
Duluth	MN	46.78	-92.11
Champaign	IL	40.12	-88.24
Near North Side	IL	41.9	-87.63
Chino	CA	34.01	-117.69
Alhambra	CA	34.1	-118.13
Ogden	UT	41.22	-111.97
Redwood City	CA	37.49	-122.24
Bellingham	WA	48.76	-122.49
O'Fallon	MO	38.81	-90.7
Hoover	AL	33.41	-86.81
Danbury	CT	41.39	-73.45
East Norwalk	CT	41.11	-73.4
Edinburg	TX	26.3	-98.16
Sunrise	FL	26.13	-80.11
Trenton	NJ	40.22	-74.74
Santa Fe	NM	35.69	-105.94
Bloomington	IN	39.17	-86.53
Cicero	IL	41.85	-87.75
Hemet	CA	33.75	-116.97
Ahwatukee Foothills	AZ	33.34	-111.98
Johns Creek	GA	34.03	-84.2
Mission	TX	26.22	-98.33
Troy	MI	42.61	-83.15
Buena Park	CA	33.87	-118
Palm Coast	FL	29.58	-81.21
Fayetteville	AR	36.06	-94.16
Sioux City	IA	42.5	-96.4
Lake Forest	CA	33.65	-117.69
Merced	CA	37.3	-120.48
Longview	TX	32.5	-94.74
Bryan	TX	30.67	-96.37
Westland	MI	42.32	-83.4
Warwick	RI	41.7	-71.42
Lakewood	CA	33.85	-118.13
Farmington Hills	MI	42.49	-83.38
San Tan Valley	AZ	33.19	-111.53
Mount Pleasant	SC	32.79	-79.86
Cranston	RI	41.78	-71.44
Largo	FL	27.91	-82.79
South Suffolk	VA	36.72	-76.59
Avondale	AZ	33.44	-112.35
Tustin	CA	33.75	-117.83
Mountain View	CA	37.39	-122.08
Napa	CA	38.3	-122.29
Somerville	MA	42.39	-71.1
Lawrence	MA	42.71	-71.16
Melbourne	FL	28.08	-80.61
Parma	OH	41.4	-81.72
New Rochelle	NY	40.91	-73.78
Lynchburg	VA	37.41	-79.14
Medford	OR	42.33	-122.88
Deerfield Beach	FL	26.32	-80.1
Pleasanton	CA	37.66	-121.87
Belmont Cragin	IL	41.93	-87.77
Brooklyn Park	MN	45.09	-93.36
Goodyear	AZ	33.44	-112.36
Kennewick	WA	46.21	-119.14
Alameda	CA	37.77	-122.26
Town 'n' Country	FL	28.01	-82.58
Bellflower	CA	33.88	-118.12
San Pedro	CA	33.74	-118.29
Chino Hills	CA	33.99	-117.76
Bloomington	IL	40.48	-88.99
Alafaya	FL	28.56	-81.21
Springdale	AR	36.19	-94.13
North Hollywood	CA	34.17	-118.38
Racine	WI	42.73	-87.78
Hammond	IN	41.58	-87.5
Milpitas	CA	37.43	-121.91
Gary	IN	41.59	-87.35
Scranton	PA	41.41	-75.66
Baldwin Park	CA	34.09	-117.96
Auburn	WA	47.31	-122.23
Fishers	IN	39.96	-86.01
Saint Joseph	MO	39.77	-94.85
Pharr	TX	26.19	-98.18
Upland	CA	34.1	-117.65
Folsom	CA	38.68	-121.18
Baytown	TX	29.74	-94.98
San Ramon	CA	37.78	-121.98
Camden	NJ	39.93	-75.12
Lake Charles	LA	30.21	-93.2
Kalamazoo	MI	42.29	-85.59
Arlington Heights	IL	42.09	-87.98
Plymouth	MN	45.01	-93.46
Waterford	MI	42.69	-83.41
Evanston	IL	42.04	-87.69
Manteca	CA	37.8	-121.22
Kendall	FL	25.68	-80.32
Wyoming	MI	42.91	-85.71
Loveland	CO	40.4	-105.07
Cheektowaga	NY	42.9	-78.75
Kings Bridge	NY	40.88	-73.91
Perris	CA	33.78	-117.23
Bethlehem	PA	40.63	-75.37
Albany	GA	31.58	-84.16
Schaumburg	IL	42.03	-88.08
Gastonia	NC	35.26	-81.19
Brownsville	NY	40.66	-73.92
Union City	CA	37.6	-122.02
Bolingbrook	IL	41.7	-88.07
Iowa City	IA	41.66	-91.53
Layton	UT	41.06	-111.97
Missouri City	TX	29.62	-95.54
Appleton	WI	44.26	-88.42
Shelby	MI	42.67	-83.03
Fort Myers	FL	26.62	-81.84
Boynton Beach	FL	26.53	-80.07
Jonesboro	AR	35.84	-90.7
South Lawndale	IL	41.84	-87.71
Logan Square	IL	41.92	-87.7
Rapid City	SD	44.08	-103.23
Warner Robins	GA	32.62	-83.63
Rochester Hills	MI	42.66	-83.15
Decatur	IL	39.84	-88.95
Southfield	MI	42.47	-83.22
Saint George	UT	37.1	-113.58
New Britain	CT	41.66	-72.78
Franklin	TN	35.93	-86.87
Turlock	CA	37.49	-120.85
Temple	TX	31.1	-97.34
West Ridge	IL	42	-87.69
Apple Valley	CA	34.5	-117.19
Lynwood	CA	33.93	-118.21
Waukesha	WI	43.01	-88.23
Wilmington	DE	39.75	-75.55
Canton	OH	40.8	-81.38
Gulfport	MS	30.37	-89.09
Pawtucket	RI	41.88	-71.38
Lauderhill	FL	26.14	-80.21
Rock Hill	SC	34.92	-81.03
Silver Spring	MD	38.99	-77.03
West Gulfport	MS	30.4	-89.09
Flower Mound	TX	33.01	-97.1
Bismarck	ND	46.81	-100.78
Centreville	VA	38.84	-77.43
Lafayette	IN	40.42	-86.88
Passaic	NJ	40.86	-74.13
Riverview	FL	27.87	-82.33
Redlands	CA	34.06	-117.18
Missoula	MT	46.87	-113.99
Rancho Cordova	CA	38.59	-121.3
New Braunfels	TX	29.7	-98.12
Cherry Hill	NJ	39.93	-75.03
Flagstaff	AZ	35.2	-111.65
Muncie	IN	40.19	-85.39
Mira Mesa	CA	32.92	-117.14
Woodland Hills	CA	34.17	-118.61
Weston	FL	26.1	-80.4
Frederick	MD	39.41	-77.41
Pasco	WA	46.24	-119.1
Pittsburg	CA	38.03	-121.88
Ridgewood	NY	40.7	-73.91
Palatine	IL	42.11	-88.03
North Richland Hills	TX	32.83	-97.23
Union City	NJ	40.78	-74.02
Kissimmee	FL	28.3	-81.42
Walnut Creek	CA	37.91	-122.06
Mount Vernon	NY	40.91	-73.84
Conroe	TX	30.31	-95.46
Dothan	AL	31.22	-85.39
Northridge	CA	34.23	-118.54
Waterloo	IA	42.49	-92.34
Maple Grove	MN	45.07	-93.46
Framingham	MA	42.28	-71.42
Redondo Beach	CA	33.85	-118.39
Bossier City	LA	32.52	-93.73
Yorba Linda	CA	33.89	-117.81
Woodbury	MN	44.92	-92.96
Eau Claire	WI	44.81	-91.5
Waldorf	MD	38.62	-76.94
Forest Hills	NY	40.72	-73.85
Davis	CA	38.54	-121.74
Glen Burnie	MD	39.16	-76.62
Camarillo	CA	34.22	-119.04
Victoria	TX	28.81	-97
Gaithersburg	MD	39.14	-77.2
Jacksonville	NC	34.75	-77.43
South San Francisco	CA	37.65	-122.41
Kenner	LA	29.99	-90.24
Jackson Heights	NY	40.76	-73.89
Rockville	MD	39.08	-77.15
Jackson	TN	35.61	-88.81
Lincoln Park	IL	41.92	-87.65
Yuba City	CA	39.14	-121.62
Portland	ME	43.66	-70.26
Palo Alto	CA	37.44	-122.14
Casas Adobes	AZ	32.32	-111
Marysville	WA	48.05	-122.18
South Jordan	UT	40.56	-111.93
Oshkosh	WI	44.02	-88.54
North Little Rock	AR	34.77	-92.27
Homestead	FL	25.47	-80.48
Bayside	NY	40.77	-73.78
Bayonne	NJ	40.67	-74.11
Eagan	MN	44.8	-93.17
Delray Beach	FL	26.46	-80.07
Johnson City	TN	36.31	-82.35
Dale City	VA	38.64	-77.31
Cedar Park	TX	30.51	-97.82
Parkchester	NY	40.84	-73.86
Atascocita	TX	30	-95.18
Saint Cloud	MN	45.56	-94.16
Ellicott City	MD	39.27	-76.8
Laguna Niguel	CA	33.52	-117.71
Saint Charles	MO	38.78	-90.48
Harlingen	TX	26.19	-97.7
San Clemente	CA	33.43	-117.61
West Lynchburg	VA	37.4	-79.18
Framingham Center	MA	42.3	-71.44
Schenectady	NY	42.81	-73.94
Broomfield	CO	39.92	-105.09
Ames	IA	42.03	-93.62
Park Slope	NY	40.67	-73.99
Shawnee	KS	39.04	-94.72
Conway	AR	35.09	-92.44
East Orange	NJ	40.77	-74.2
Portage Park	IL	41.96	-87.77
Skokie	IL	42.03	-87.73
Daytona Beach	FL	29.21	-81.02
West Bloomfield Township	MI	42.57	-83.38
Tamarac	FL	26.21	-80.25
Youngstown	OH	41.1	-80.65
Lodi	CA	38.13	-121.27
Greenville	SC	34.85	-82.39
Mansfield	TX	32.56	-97.14
Santa Cruz	CA	36.97	-122.03
Pico Rivera	CA	33.98	-118.1
Madera	CA	36.96	-120.06
Janesville	WI	42.68	-89.02
West Des Moines	IA	41.58	-93.71
Montebello	CA	34.01	-118.11
Georgetown	TX	30.63	-97.68
Alpharetta	GA	34.08	-84.29
Lorain	OH	41.45	-82.18
Bowling Green	KY	36.99	-86.44
Flatlands	NY	40.62	-73.93
Dundalk	MD	39.25	-76.52
Eden Prairie	MN	44.85	-93.47
North Bergen	NJ	40.8	-74.01
Florence-Graham	CA	33.97	-118.24
Waltham	MA	42.38	-71.24
Cheyenne	WY	41.14	-104.82
West Hartford	CT	41.76	-72.74
Rogers	AR	36.33	-94.12
Carol City	FL	25.94	-80.25
Encinitas	CA	33.04	-117.29
East Village	NY	40.73	-73.99
Haverhill	MA	42.78	-71.08
Jupiter	FL	26.93	-80.09
Council Bluffs	IA	41.26	-95.86
Wellington	FL	26.66	-80.24
West Coon Rapids	MN	45.16	-93.35
North Miami	FL	25.89	-80.19
Hamilton	OH	39.4	-84.56
North Port	FL	27.04	-82.24
Tulare	CA	36.21	-119.35
Coon Rapids	MN	45.12	-93.29
Millcreek	UT	40.69	-111.88
La Habra	CA	33.93	-117.95
Blaine	MN	45.16	-93.23
Auburn	AL	32.61	-85.48
Lake Elsinore	CA	33.67	-117.33
Carmichael	CA	38.62	-121.33
Taylor	MI	42.24	-83.27
Burnsville	MN	44.77	-93.28
Monterey Park	CA	34.06	-118.12
Castro Valley	CA	37.69	-122.09
Irvington	NJ	40.73	-74.23
Rocklin	CA	38.79	-121.24
Utica	NY	43.1	-75.23
Malden	MA	42.43	-71.07
National City	CA	32.68	-117.1
Financial District	NY	40.71	-74.01
Springfield	OR	44.05	-123.02
Bethesda	MD	38.98	-77.1
Terre Haute	IN	39.47	-87.41
Vineland	NJ	39.49	-75.03
West Hollywood	FL	26.02	-80.18
San Marcos	TX	29.88	-97.94
Brentwood	NY	40.78	-73.25
Lakeville	MN	44.65	-93.24
West Allis	WI	43.02	-88.01
Redmond	WA	47.67	-122.12
Canoga Park	CA	34.2	-118.6
Cupertino	CA	37.32	-122.03
Taylorsville	UT	40.67	-111.94
Bristol	CT	41.67	-72.95
Moore	OK	35.34	-97.49
Gardena	CA	33.89	-118.31
Petaluma	CA	38.23	-122.64
Grand Junction	CO	39.06	-108.55
Casper	WY	42.87	-106.31
Rowlett	TX	32.9	-96.56
La Mesa	CA	32.77	-117.02
Pine Hills	FL	28.56	-81.45
Bensonhurst	NY	40.6	-73.99
Coney Island	NY	40.58	-73.99
Rancho Penasquitos	CA	32.96	-117.12
Valley Glen	CA	34.19	-118.45
Meriden	CT	41.54	-72.81
Pontiac	MI	42.64	-83.29
Port Orange	FL	29.14	-81
Hamden	CT	41.4	-72.9
Lakewood	WA	47.17	-122.52
Fountainebleau	FL	25.77	-80.35
Saint Clair Shores	MI	42.5	-82.89
Springfield	OH	39.92	-83.81
Great Falls	MT	47.5	-111.3
Chapel Hill	NC	35.91	-79.06
Huntington Park	CA	33.98	-118.23
Lancaster	PA	40.04	-76.31
Coconut Creek	FL	26.25	-80.18
Idaho Falls	ID	43.47	-112.03
San Rafael	CA	37.97	-122.53
Noblesville	IN	40.05	-86.01
Marietta	GA	33.95	-84.55
Fairfield	CT	41.14	-73.26
Owensboro	KY	37.77	-87.11
Eastvale	CA	33.96	-117.56
Royal Oak	MI	42.49	-83.14
Brentwood	CA	37.93	-121.7
Dubuque	IA	42.5	-90.66
Brookline	MA	42.33	-71.12
Novi	MI	42.48	-83.48
Des Plaines	IL	42.03	-87.88
Orland Park	IL	41.63	-87.85
Bartlett	TN	35.2	-89.87
Woodland	CA	38.68	-121.77
Lehi	UT	40.39	-111.85
White Plains	NY	41.03	-73.76
Arcadia	CA	34.14	-118.04
Reston	VA	38.97	-77.34
Ocala	FL	29.19	-82.14
Central City	AZ	33.44	-112.06
South Vineland	NJ	39.45	-75.03
Sanford	FL	28.8	-81.27
Bowie	MD	38.94	-76.73
Kokomo	IN	40.49	-86.13
Wayne	NJ	40.93	-74.28
Santee	CA	32.84	-116.97
Dublin	CA	37.7	-121.94
Palm Harbor	FL	28.08	-82.76
Medford	MA	42.42	-71.11
Midwest City	OK	35.45	-97.4
Center City	PA	39.95	-75.16
Margate	FL	26.24	-80.21
South Whittier	CA	33.95	-118.04
Tinley Park	IL	41.57	-87.78
Pflugerville	TX	30.44	-97.62
New Brunswick	NJ	40.49	-74.45
Grand Forks	ND	47.93	-97.03
Fountain Valley	CA	33.71	-117.95
North Hills	CA	34.24	-118.48
Diamond Bar	CA	34.03	-117.81
Taunton	MA	41.9	-71.09
Oak Lawn	IL	41.71	-87.76
Union	NJ	40.7	-74.26
Ankeny	IA	41.73	-93.61
Chicopee	MA	42.15	-72.61
Irving Park	IL	41.95	-87.74
Berwyn	IL	41.85	-87.79
Manhattan	KS	39.18	-96.57
Kendale Lakes	FL	25.71	-80.41
Smyrna	GA	33.88	-84.51
Dearborn Heights	MI	42.34	-83.27
Porterville	CA	36.07	-119.02
Piscataway	NJ	40.5	-74.4
Doral	FL	25.82	-80.36
Hendersonville	TN	36.3	-86.62
Morningside Heights	NY	40.81	-73.96
Rocky Mount	NC	35.94	-77.79
Corvallis	OR	44.56	-123.26
Valdosta	GA	30.83	-83.28
Hanford	CA	36.33	-119.65
Castle Rock	CO	39.37	-104.86
Greenwood	IN	39.61	-86.11
Chicago Lawn	IL	41.78	-87.7
Hempstead	NY	40.71	-73.62
Novato	CA	38.11	-122.57
Kettering	OH	39.69	-84.17
Bellevue	NE	41.14	-95.89
Shoreline	WA	47.76	-122.34
Decatur	AL	34.61	-86.98
Paramount	CA	33.89	-118.16
Port Arthur	TX	29.89	-93.94
Anderson	IN	40.11	-85.68
Tamiami	FL	25.76	-80.4
Towson	MD	39.4	-76.6
North Chicopee	MA	42.18	-72.6
Uptown	IL	41.97	-87.65
Sarasota	FL	27.34	-82.53
Cypress Hills	NY	40.68	-73.89
West Haven	CT	41.27	-72.95
Rosemead	CA	34.08	-118.07
Edgewater	IL	41.98	-87.66
Jackson	NJ	39.78	-74.86
Highland	CA	34.13	-117.21
Mount Prospect	IL	42.07	-87.94
Colton	CA	34.07	-117.31
Encanto	AZ	33.48	-112.08
Carson City	NV	39.16	-119.77
Pocatello	ID	42.87	-112.45
Bradenton	FL	27.5	-82.57
Rogers Park	IL	42.01	-87.67
Weymouth	MA	42.22	-70.94
Port Charlotte	FL	26.98	-82.09
Normal	IL	40.51	-88.99
Spring	TX	30.08	-95.42
Allapattah	FL	25.81	-80.22
Richland	WA	46.29	-119.28
Euless	TX	32.84	-97.08
Blue Springs	MO	39.02	-94.28
East Pensacola Heights	FL	30.43	-87.18
Hacienda Heights	CA	33.99	-117.97
Ozone Park	NY	40.68	-73.84
Briarwood	NY	40.71	-73.82
Cathedral City	CA	33.78	-116.47
Lakewood	NJ	40.1	-74.22
Elyria	OH	41.37	-82.11
Wheaton	IL	41.87	-88.11
Commerce City	CO	39.81	-104.93
Hoboken	NJ	40.74	-74.03
Watsonville	CA	36.91	-121.76
Lake Havasu City	AZ	34.48	-114.32
Revere	MA	42.41	-71.01
West New York	NJ	40.79	-74.01
Yucaipa	CA	34.03	-117.04
Gilroy	CA	37.01	-121.57
Pensacola	FL	30.42	-87.22
Poinciana	FL	28.14	-81.46
Kingsport	TN	36.55	-82.56
Levittown	PA	40.16	-74.83
Palm Beach Gardens	FL	26.82	-80.14
Milford	CT	41.22	-73.06
Delano	CA	35.77	-119.25
West Sacramento	CA	38.58	-121.53
Huntersville	NC	35.41	-80.84
Perth Amboy	NJ	40.51	-74.27
Sherman Oaks	CA	34.15	-118.45
Southaven	MS	34.99	-90.01
Saint Peters	MO	38.8	-90.63
Harrisonburg	VA	38.45	-78.87
Peabody	MA	42.53	-70.93
Placentia	CA	33.87	-117.87
Lenexa	KS	38.95	-94.73
DeSoto	TX	32.59	-96.86
Burlington	NC	36.1	-79.44
South Hill	WA	47.14	-122.27
Elkhart	IN	41.68	-85.98
La Crosse	WI	43.8	-91.24
Oak Park	IL	41.89	-87.78
Florissant	MO	38.79	-90.32
Sammamish	WA	47.64	-122.08
Wakefield	NY	40.9	-73.85
Albany	OR	44.64	-123.11
Hoffman Estates	IL	42.04	-88.08
Albany Park	IL	41.97	-87.72
Glendora	CA	34.14	-117.87
Queens Village	NY	40.73	-73.74
Brookhaven	GA	33.86	-84.34
Levittown	NY	40.73	-73.51
Palm Desert	CA	33.72	-116.38
Joplin	MO	37.08	-94.51
Enid	OK	36.4	-97.88
Bonita Springs	FL	26.34	-81.78
Irondequoit	NY	43.21	-77.58
Caldwell	ID	43.66	-116.69
Minnetonka	MN	44.91	-93.5
Pinellas Park	FL	27.84	-82.7
Battle Creek	MI	42.32	-85.18
Casa Grande	AZ	32.88	-111.76
South Shore	IL	41.76	-87.58
Mott Haven	NY	40.81	-73.92
The Villages	FL	28.93	-81.96
Grand Island	NE	40.93	-98.34
Grapevine	TX	32.93	-97.08
Stratford	CT	41.18	-73.13
Kentwood	MI	42.87	-85.64
City of Milford (balance)	CT	41.22	-73.06
Tigard	OR	45.43	-122.77
East Hartford	CT	41.78	-72.61
Apple Valley	MN	44.73	-93.22
Plainfield	NJ	40.63	-74.41
Leesburg	VA	39.12	-77.56
Parsippany	NJ	40.86	-74.43
Coral Gables	FL	25.72	-80.27
The Hammocks	FL	25.67	-80.44
Buckeye	AZ	33.37	-112.58
Flagami	FL	25.76	-80.32
Catalina Foothills	AZ	32.3	-110.92
Lakewood	OH	41.48	-81.8
North La Crosse	WI	43.85	-91.25
Burien	WA	47.47	-122.35
Logan	UT	41.74	-111.83
Olympia	WA	47.04	-122.9
South Peabody	MA	42.51	-70.95
Aliso Viejo	CA	33.57	-117.73
Galveston	TX	29.3	-94.8
Poway	CA	32.96	-117.04
Edina	MN	44.89	-93.35
Minnetonka Mills	MN	44.94	-93.44
Stonecrest	GA	33.71	-84.13
Cerritos	CA	33.86	-118.06
Redford	MI	42.38	-83.3
East Honolulu	HI	21.29	-157.72
Troy	NY	42.73	-73.69
Sunnyside	NY	40.74	-73.94
Charleston	WV	38.35	-81.63
Wharton	PA	39.93	-75.16
Whitman	PA	39.92	-75.16
Downers Grove	IL	41.81	-88.01
Azusa	CA	34.13	-117.91
Wilson	NC	35.72	-77.92
Monroe	LA	32.51	-92.12
Parker	CO	39.52	-104.76
La Mirada	CA	33.92	-118.01
Minot	ND	48.23	-101.3
Aloha	OR	45.49	-122.87
Saginaw	MI	43.42	-83.95
Bedford	TX	32.84	-97.14
Rancho Santa Margarita	CA	33.64	-117.6
Cypress	CA	33.82	-118.04
Murray	UT	40.67	-111.89
Cuyahoga Falls	OH	41.13	-81.48
Coeur d'Alene	ID	47.68	-116.78
Bloomfield	NJ	40.81	-74.19
Harrisburg	PA	40.27	-76.88
Rowland Heights	CA	33.98	-117.91
Covina	CA	34.09	-117.89
Stillwater	OK	36.12	-97.06
Niagara Falls	NY	43.09	-79.06
Collierville	TN	35.04	-89.66
Summerville	SC	33.02	-80.18
South Bel Air	MD	39.53	-76.34
Sheboygan	WI	43.75	-87.71
Middletown	OH	39.52	-84.4
Aspen Hill	MD	39.08	-77.07
Dunwoody	GA	33.95	-84.33
Huntington	WV	38.42	-82.45
Maricopa	AZ	33.06	-112.05
Roswell	NM	33.39	-104.52
Cedar Hill	TX	32.59	-96.96
East Brunswick	NJ	40.43	-74.42
East Lansing	MI	42.74	-84.48
Apopka	FL	28.68	-81.51
Maspeth	NY	40.72	-73.91
Wheaton	MD	39.04	-77.06
Mishawaka	IN	41.66	-86.16
Portage	MI	42.2	-85.58
West Orange	NJ	40.8	-74.24
McLean	VA	38.93	-77.18
Newark	OH	40.06	-82.4
Ceres	CA	37.59	-120.96
Alexandria	LA	31.31	-92.45
Chesterfield	MO	38.66	-90.58
Barnstable	MA	41.7	-70.3
Salina	KS	38.84	-97.61
Lawrence	IN	39.84	-86.03
Bel Air South	MD	39.51	-76.32
Pearl City	HI	21.4	-157.98
Euclid	OH	41.59	-81.53
Roseville	MI	42.5	-82.94
Texas City	TX	29.38	-94.9
Wauwatosa	WI	43.05	-88.01
Florin	CA	38.5	-121.41
Twin Falls	ID	42.56	-114.46
Glenview	IL	42.07	-87.79
East Providence	RI	41.81	-71.37
Palm Springs	CA	33.83	-116.55
San Luis Obispo	CA	35.28	-120.66
Methuen	MA	42.73	-71.19
Mission District	CA	37.76	-122.42
Country Club	FL	25.95	-80.32
Madison	AL	34.7	-86.75
Jeffersonville	IN	38.28	-85.74
San Jacinto	CA	33.78	-116.96
Mentor	OH	41.67	-81.34
Mansfield	OH	40.76	-82.52
Hattiesburg	MS	31.33	-89.29
Draper	UT	40.52	-111.86
Middletown	CT	41.56	-72.65
Wylie	TX	33.02	-96.54
Columbus	IN	39.2	-85.92
Laguna	CA	38.42	-121.42
Smyrna	TN	35.98	-86.52
Charlottesville	VA	38.03	-78.48
Lincoln	CA	38.89	-121.29
Lacey	WA	47.03	-122.82
Littleton	CO	39.61	-105.02
Beavercreek	OH	39.71	-84.06
Kannapolis	NC	35.49	-80.62
Everett	MA	42.41	-71.05
Binghamton	NY	42.1	-75.92
Cypress	TX	29.97	-95.7
Elmhurst	IL	41.9	-87.94
Hell's Kitchen	NY	40.76	-73.99
Auburn Gresham	IL	41.74	-87.65
City of Sammamish	WA	47.6	-122.04
Antelope	CA	38.71	-121.33
Keller	TX	32.93	-97.25
Biloxi	MS	30.4	-88.89
Apex	NC	35.73	-78.85
West Lafayette	IN	40.43	-86.91
Titusville	FL	28.61	-80.81
Altoona	PA	40.52	-78.39
Newark	CA	37.53	-122.04
Saint Louis Park	MN	44.95	-93.35
Enfield	CT	41.98	-72.59
Dublin	OH	40.1	-83.11
Tuckahoe	VA	37.59	-77.56
Potomac	MD	39.02	-77.21
Cleveland Heights	OH	41.52	-81.56
Sayreville	NJ	40.46	-74.36
Cutler Bay	FL	25.58	-80.34
Hackensack	NJ	40.89	-74.04
Pine Bluff	AR	34.23	-92
West Seneca	NY	42.85	-78.8
Strongsville	OH	41.31	-81.84
Coachella	CA	33.68	-116.17
Penn Hills	PA	40.5	-79.84
Encino	CA	34.16	-118.5
Bentonville	AR	36.37	-94.21
Fort Pierce	FL	27.45	-80.33
Bridgewater	NJ	40.6	-74.65
Danville	CA	37.82	-122
Oakland Park	FL	26.17	-80.13
Attleboro	MA	41.94	-71.29
Severn	MD	39.14	-76.7
Blacksburg	VA	37.23	-80.41
Haltom City	TX	32.8	-97.27
Brighton Park	IL	41.82	-87.7
Lompoc	CA	34.64	-120.46
Wesley Chapel	FL	28.24	-82.33
Urbandale	IA	41.63	-93.71
York	PA	39.96	-76.73
North Miami Beach	FL	25.93	-80.16
El Centro	CA	32.79	-115.56
Rego Park	NY	40.73	-73.85
Cleveland	TN	35.16	-84.88
Echo Park	CA	34.08	-118.26
North Bethesda	MD	39.04	-77.12
Beaumont	CA	33.93	-116.98
Lombard	IL	41.88	-88.01
Bountiful	UT	40.89	-111.88
North Lauderdale	FL	26.22	-80.23
Burleson	TX	32.54	-97.32
Ocoee	FL	28.57	-81.54
Oro Valley	AZ	32.39	-110.97
Ashburn	VA	39.04	-77.49
Augusta	GA	33.47	-81.97
Bozeman	MT	45.68	-111.04
Sierra Vista	AZ	31.55	-110.3
Freeport	NY	40.66	-73.58
Pittsfield	MA	42.45	-73.25
Hilo	HI	19.73	-155.09
West Babylon	NY	40.72	-73.35
DeKalb	IL	41.93	-88.75
San Bruno	CA	37.63	-122.41
Jefferson City	MO	38.58	-92.17
Altamonte Springs	FL	28.66	-81.37
Bell Gardens	CA	33.97	-118.15
Morgan Hill	CA	37.13	-121.65
Bothell	WA	47.76	-122.21
Fond du Lac	WI	43.78	-88.44
Sicklerville	NJ	39.72	-74.97
Sayreville Junction	NJ	40.47	-74.33
Farmington	NM	36.73	-108.22
Salem	MA	42.52	-70.9
Arlington	MA	42.42	-71.16
La Jolla	CA	32.85	-117.27
Altadena	CA	34.19	-118.13
Fairfield	OH	39.35	-84.56
Ashburn	IL	41.75	-87.71
Rancho Palos Verdes	CA	33.74	-118.39
North Highlands	CA	38.69	-121.37
Moline	IL	41.51	-90.52
Concord	NH	43.21	-71.54
East Concord	NH	43.24	-71.54
Rockwall	TX	32.93	-96.46
Plainfield	IL	41.63	-88.2
Burlington	VT	44.48	-73.21
Rohnert Park	CA	38.34	-122.7
Urbana	IL	40.11	-88.21
Southglenn	CO	39.59	-104.95
Midland	MI	43.62	-84.25
Prescott Valley	AZ	34.61	-112.32
State College	PA	40.79	-77.86
Kearny	NJ	40.77	-74.15
El Dorado Hills	CA	38.69	-121.08
Danville	VA	36.59	-79.4
Belleville	IL	38.52	-89.98
Linden	NJ	40.62	-74.24
Moorhead	MN	46.87	-96.77
Woodside	NY	40.75	-73.91
Brea	CA	33.92	-117.9
Riverton	UT	40.52	-111.94
Prescott	AZ	34.54	-112.47
Mount Laurel	NJ	39.93	-74.89
The Colony	TX	33.09	-96.89
Manassas	VA	38.75	-77.48
Brentwood	TN	36.03	-86.78
Westfield	MA	42.13	-72.75
Hutchinson	KS	38.06	-97.93
Leominster	MA	42.53	-71.76
Catonsville	MD	39.27	-76.73
Hicksville	NY	40.77	-73.53
Bartlett	IL	42	-88.19
Buffalo Grove	IL	42.15	-87.96
Woonsocket	RI	42	-71.51
West Hills	CA	34.2	-118.64
Edmonds	WA	47.81	-122.38
Marana	AZ	32.44	-111.23
Shelton	CT	41.32	-73.09
Cedar Falls	IA	42.53	-92.45
Chatsworth	CA	34.26	-118.6
Gage Park	IL	41.8	-87.7
Beverly	MA	42.56	-70.88
University	FL	28.07	-82.44
Coppell	TX	32.95	-97.02
Findlay	OH	41.04	-83.65
Campbell	CA	37.29	-121.95
Lake Ridge	VA	38.69	-77.3
Burke	VA	38.79	-77.27
Mankato	MN	44.16	-94.01
Annandale	VA	38.83	-77.2
Covington	KY	39.08	-84.51
New City	IL	41.81	-87.66
Morris Heights	NY	40.85	-73.92
Peachtree Corners	GA	33.97	-84.22
South Valley	NM	35.01	-106.68
Ormond Beach	FL	29.29	-81.06
Carrollwood Village	FL	28.07	-82.52
Huntsville	TX	30.72	-95.55
Venice	CA	33.99	-118.46
Sumter	SC	33.92	-80.34
Quincy	IL	39.94	-91.41
Wilkes-Barre	PA	41.25	-75.88
Lincoln Square	IL	41.98	-87.69
La Puente	CA	34.02	-117.95
Holyoke	MA	42.2	-72.62
Sherman	TX	33.64	-96.61
Goose Creek	SC	32.98	-80.03
Maplewood	MN	44.95	-93
Streamwood	IL	42.03	-88.18
Fitchburg	MA	42.58	-71.8
Hilton Head Island	SC	32.19	-80.74
La Quinta	CA	33.66	-116.31
North Atlanta	GA	33.87	-84.34
Crystal Lake	IL	42.24	-88.32
Hagerstown	MD	39.64	-77.72
San Gabriel	CA	34.1	-118.11
Hickory	NC	35.73	-81.34
Beverly Cove	MA	42.55	-70.85
Winter Garden	FL	28.57	-81.59
Carol Stream	IL	41.91	-88.13
Warren	OH	41.24	-80.82
Marlboro	NJ	40.32	-74.25
Teaneck	NJ	40.9	-74.02
Calexico	CA	32.68	-115.5
Florence	AL	34.8	-87.68
St. Johns	FL	30.08	-81.55
Shakopee	MN	44.8	-93.53
Billerica	MA	42.56	-71.27
Norwich	CT	41.52	-72.08
Amherst	MA	42.37	-72.52
Duncanville	TX	32.65	-96.91
New Berlin	WI	42.98	-88.11
Marlborough	MA	42.35	-71.55
Oakley	CA	38	-121.71
Lancaster	OH	39.71	-82.6
Avondale	IL	41.94	-87.71
Romeoville	IL	41.65	-88.09
Culver City	CA	34.02	-118.4
Montclair	NJ	40.83	-74.21
Meridian	MS	32.36	-88.7
Puyallup	WA	47.19	-122.29
Woburn	MA	42.48	-71.15
Bremerton	WA	47.57	-122.63
Hallandale Beach	FL	25.98	-80.15
Clovis	NM	34.4	-103.21
Annapolis	MD	38.98	-76.49
Weslaco	TX	26.16	-97.99
Cape Girardeau	MO	37.31	-89.52
Bullhead City	AZ	35.15	-114.57
North Fort Myers	FL	26.67	-81.88
Chelsea	MA	42.39	-71.03
Grove City	OH	39.88	-83.09
Essex	MD	39.31	-76.47
Atlantic City	NJ	39.36	-74.42
Pacifica	CA	37.61	-122.49
Germantown	TN	35.09	-89.81
Northglenn	CO	39.89	-104.99
Far Rockaway	NY	40.61	-73.76
Kensington	NY	40.65	-73.97
Coram	NY	40.87	-73
Wausau	WI	44.96	-89.63
Hurst	TX	32.82	-97.17
Stanton	CA	33.8	-117.99
Lancaster	TX	32.59	-96.76
Friendswood	TX	29.53	-95.2
Gainesville	GA	34.3	-83.82
The Acreage	FL	26.79	-80.27
Montclair	CA	34.08	-117.69
Kailua	HI	21.4	-157.74
Rock Island	IL	41.51	-90.58
Whitney	NV	36.1	-115.04
Oviedo	FL	28.67	-81.21
Carpentersville	IL	42.12	-88.26
Lake Oswego	OR	45.42	-122.67
Muskogee	OK	35.75	-95.37
Hobbs	NM	32.7	-103.14
Muskegon	MI	43.23	-86.25
Westerville	OH	40.13	-82.93
Little Elm	TX	33.16	-96.94
Hanover Park	IL	42	-88.15
Channelview	TX	29.78	-95.11
Panama City	FL	30.16	-85.66
Florence	SC	34.2	-79.76
Waipahu	HI	21.39	-158.01
Wake Forest	NC	35.98	-78.51
Huber Heights	OH	39.84	-84.12
Martinez	CA	38.02	-122.13
East Meadow	NY	40.71	-73.56
Hanover	MD	39.19	-76.72
Wheeling	IL	42.14	-87.93
Apache Junction	AZ	33.42	-111.55
Pleasant Grove	UT	40.36	-111.74
Brookfield	WI	43.06	-88.11
Delaware	OH	40.3	-83.07
Roy	UT	41.16	-112.03
Valley Stream	NY	40.66	-73.71
Schertz	TX	29.55	-98.27
Spanish Fork	UT	40.11	-111.65
Keizer	OR	44.99	-123.03
Leander	TX	30.58	-97.85
Woodlawn	MD	39.32	-76.73
Lima	OH	40.74	-84.11
Spartanburg	SC	34.95	-81.93
Park Ridge	IL	42.01	-87.84
Winter Haven	FL	28.02	-81.73
Aventura	FL	25.96	-80.14
Severna Park	MD	39.07	-76.55
Royal Palm Beach	FL	26.71	-80.23
Brighton	CO	39.99	-104.82
Phenix City	AL	32.47	-85
Milton	GA	34.13	-84.3
Dover	DE	39.16	-75.52
Sun City	AZ	33.6	-112.27
Lake Worth	FL	26.62	-80.07
Kew Gardens Hills	NY	40.73	-73.82
Jamaica Plain	MA	42.31	-71.12
Monrovia	CA	34.15	-118
Hollister	CA	36.85	-121.4
Los Banos	CA	37.06	-120.85
Plant City	FL	28.02	-82.11
Greenfield	WI	42.96	-88.01
Marion	IA	42.03	-91.6
Braintree	MA	42.2	-71
Newnan	GA	33.38	-84.8
Texarkana	TX	33.43	-94.05
Addison	IL	41.93	-87.99
Reynoldsburg	OH	39.95	-82.81
South Jordan Heights	UT	40.56	-111.95
Odenton	MD	39.08	-76.7
Mableton	GA	33.82	-84.58
Hilton Head	SC	32.22	-80.75
Grants Pass	OR	42.44	-123.33
Indian Trail	NC	35.08	-80.67
Calumet City	IL	41.62	-87.53
Lincoln Park	MI	42.25	-83.18
Lynnwood	WA	47.82	-122.32
Whitestone	NY	40.79	-73.82
Beloit	WI	42.51	-89.03
Belleville	NJ	40.79	-74.15
Longview	WA	46.14	-122.94
Columbia	TN	35.62	-87.04
Portage	IN	41.58	-87.18
Westfield	IN	40.04	-86.13
New Albany	IN	38.29	-85.82
Fort Lee	NJ	40.85	-73.97
Brighton	NY	43.15	-77.55
Bartlesville	OK	36.75	-95.98
Ewing	NJ	40.27	-74.8
San Juan	TX	26.19	-98.16
Woodhaven	NY	40.69	-73.86
Mission Bend	TX	29.69	-95.66
San Juan Capistrano	CA	33.5	-117.66
Pahrump	NV	36.21	-115.98
Saint Charles	MD	38.6	-76.94
Temple City	CA	34.11	-118.06
Marion	OH	40.59	-83.13
Mechanicsville	VA	37.61	-77.37
Lufkin	TX	31.34	-94.73
Pennsauken	NJ	39.96	-75.06
Rome	GA	34.26	-85.16
Claremont	CA	34.1	-117.72
Franklin	WI	42.89	-88.04
West Hollywood	CA	34.09	-118.36
Richfield	MN	44.88	-93.28
Bell	CA	33.98	-118.19
Lewiston	ME	44.1	-70.21
Dunedin	FL	28.02	-82.77
Kendall West	FL	25.71	-80.44
Del Rio	TX	29.36	-100.9
Oakville	MO	38.47	-90.3
Commack	NY	40.84	-73.29
Menomonee Falls	WI	43.18	-88.12
Moorpark	CA	34.29	-118.88
Gadsden	AL	34.01	-86.01
Issaquah	WA	47.53	-122.03
Spring Hill	TN	35.75	-86.93
Trumbull	CT	41.24	-73.2
Olive Branch	MS	34.96	-89.83
Mooresville	NC	35.58	-80.81
West Torrington	CT	41.82	-73.14
Willowbrook	CA	33.92	-118.26
Leavenworth	KS	39.31	-94.92
Clinton	MD	38.77	-76.9
Cottage Grove	MN	44.83	-92.94
Wildwood	MO	38.58	-90.66
Richmond	IN	39.83	-84.89
Oregon City	OR	45.36	-122.61
Goldsboro	NC	35.38	-77.99
Manhattan Beach	CA	33.88	-118.41
Parkland	WA	47.16	-122.43
Martinez	GA	33.52	-82.08
East Florence	AL	34.81	-87.65
Kyle	TX	29.99	-97.88
Kearns	UT	40.66	-112
Linton Hall	VA	38.76	-77.57
South Miami Heights	FL	25.6	-80.38
Tupelo	MS	34.26	-88.7
Hot Springs	AR	34.5	-93.06
Wildomar	CA	33.6	-117.28
Wentzville	MO	38.81	-90.85
Roseville	MN	45.01	-93.16
Valrico	FL	27.94	-82.24
Coventry	RI	41.7	-71.68
Rosenberg	TX	29.56	-95.81
Bettendorf	IA	41.52	-90.52
East Point	GA	33.68	-84.44
Prattville	AL	32.46	-86.46
Ponte Vedra Beach	FL	30.24	-81.39
Boardman	OH	41.02	-80.66
Cooper City	FL	26.06	-80.27
Oxon Hill-Glassmanor	MD	38.8	-76.97
Egypt Lake-Leto	FL	28.02	-82.51
North Lawndale	IL	41.86	-87.72
Oak Creek	WI	42.89	-87.86
Peachtree City	GA	33.4	-84.6
Merrillville	IN	41.48	-87.33
Hot Springs National Park	AR	34.53	-93.06
Saint Cloud	FL	28.25	-81.28
La Porte	TX	29.67	-95.02
University City	MO	38.66	-90.31
Upper Arlington	OH	39.99	-83.06
Torrington	CT	41.8	-73.12
Beverly Hills	CA	34.07	-118.4
Inver Grove Heights	MN	44.85	-93.04
Cumberland	RI	41.97	-71.43
Pleasant Hill	CA	37.95	-122.06
Stow	OH	41.16	-81.44
Lauderdale Lakes	FL	26.17	-80.21
La Vergne	TN	36.02	-86.58
Winter Springs	FL	28.7	-81.31
Merritt Island	FL	28.54	-80.67
Greenpoint	NY	40.72	-73.95
West Little River	FL	25.86	-80.24
Brunswick	OH	41.24	-81.84
San Dimas	CA	34.11	-117.81
Monroe	NC	34.99	-80.55
North Center	IL	41.95	-87.68
Queen Creek	AZ	33.25	-111.63
Kaneohe	HI	21.4	-157.8
Gahanna	OH	40.02	-82.88
Leawood	KS	38.97	-94.62
Owasso	OK	36.27	-95.85
Derry Village	NH	42.89	-71.31
Orange	NJ	40.77	-74.23
Central Islip	NY	40.79	-73.2
Norristown	PA	40.12	-75.34
Lower West Side	IL	41.85	-87.67
Dyker Heights	NY	40.62	-74.01
Glendale	NY	40.7	-73.89
Cottonwood Heights	UT	40.62	-111.81
Gallatin	TN	36.39	-86.45
Houma	LA	29.6	-90.72
Rubidoux	CA	34	-117.41
Collinwood	OH	41.56	-81.57
Glendale Heights	IL	41.91	-88.06
Butte	MT	46	-112.53
Dana Point	CA	33.47	-117.7
Benton	AR	34.56	-92.59
Vestavia Hills	AL	33.45	-86.79
La Presa	CA	32.71	-117
Oakton	VA	38.88	-77.3
Chester	PA	39.85	-75.36
Mount Vernon	WA	48.42	-122.33
Studio City	CA	34.15	-118.4
Salisbury	NC	35.67	-80.47
Riviera Beach	FL	26.78	-80.06
Orangevale	CA	38.68	-121.23
Oswego	IL	41.68	-88.35
El Mirage	AZ	33.61	-112.32
West Lake Sammamish	WA	47.58	-122.1
North Bel Air	MD	39.54	-76.35
Chelmsford	MA	42.6	-71.37
Bay City	MI	43.59	-83.89
Nacogdoches	TX	31.6	-94.66
Shrewsbury	MA	42.3	-71.71
McMinnville	OR	45.21	-123.2
Bridgeport	IL	41.84	-87.65
Dalton	GA	34.77	-84.97
Olney	MD	39.15	-77.07
North Providence	RI	41.85	-71.47
Newark	DE	39.68	-75.75
Oak Hill	VA	38.93	-77.4
Deer Park	TX	29.71	-95.12
Holland	MI	42.79	-86.11
Throgs Neck	NY	40.82	-73.82
Northbrook	IL	42.13	-87.83
Hilliard	OH	40.03	-83.16
Wenatchee	WA	47.42	-120.31
West Fargo	ND	46.87	-96.9
Fair Lawn	NJ	40.94	-74.13
Kennesaw	GA	34.02	-84.62
New City	NY	41.15	-73.99
Long Beach	NY	40.59	-73.66
Richmond	KY	37.75	-84.29
Suitland-Silver Hill	MD	38.85	-76.93
Chillum	MD	38.96	-76.99
Foster City	CA	37.56	-122.27
Fairborn	OH	39.82	-84.02
Menlo Park	CA	37.45	-122.18
Chicago Loop	IL	41.88	-87.63
Lawndale	CA	33.89	-118.35
Hinesville	GA	31.85	-81.6
Waxahachie	TX	32.39	-96.85
St. Charles	MD	38.61	-76.92
Woodridge	IL	41.75	-88.05
Carrollwood	FL	28.05	-82.49
Elk Grove Village	IL	42	-87.97
Pekin	IL	40.57	-89.64
Socorro	TX	31.65	-106.3
Elmont	NY	40.7	-73.71
Adelanto	CA	34.58	-117.41
Tooele	UT	40.53	-112.3
Golden Glades	FL	25.91	-80.2
Marrero	LA	29.9	-90.1
Jackson	MI	42.25	-84.4
Foothill Farms	CA	38.68	-121.35
Englewood	CO	39.65	-104.99
Copperas Cove	TX	31.12	-97.9
Bath Beach	NY	40.6	-74
Huntington Station	NY	40.85	-73.41
Seaside	CA	36.61	-121.85
Kearney	NE	40.7	-99.08
Redan	GA	33.75	-84.13
Manitowoc	WI	44.09	-87.66
Williamsburg	NY	40.71	-73.95
Goshen	IN	41.58	-85.83
Saint Charles	IL	41.91	-88.31
Greenacres City	FL	26.62	-80.13
Salisbury	MD	38.36	-75.6
Douglasville	GA	33.75	-84.75
Silver Lake	CA	34.09	-118.27
Security-Widefield	CO	38.75	-104.71
University Place	WA	47.24	-122.55
Pullman	WA	46.73	-117.18
Juneau	AK	58.3	-134.42
West Lawn	IL	41.77	-87.72
Mount Lebanon	PA	40.36	-80.05
Alabaster	AL	33.24	-86.82
Farmers Branch	TX	32.93	-96.9
Oildale	CA	35.42	-119.02
La Verne	CA	34.1	-117.77
Mason	OH	39.36	-84.31
Eastpointe	MI	42.47	-82.96
Gillette	WY	44.29	-105.5
Valparaiso	IN	41.47	-87.06
Midvale	UT	40.61	-111.9
Spring Valley	NY	41.11	-74.04
Rome	NY	43.21	-75.46
Lewiston	ID	46.42	-117.02
North Ridgeville	OH	41.39	-82.02
Petersburg	VA	37.23	-77.4
Ken Caryl	CO	39.58	-105.11
Randallstown	MD	39.37	-76.8
Westlake	OH	41.46	-81.92
Bangor	ME	44.8	-68.78
Clermont	FL	28.55	-81.77
Sun Prairie	WI	43.18	-89.21
Georgetown	KY	38.21	-84.56
Greater Grand Crossing	IL	41.76	-87.61
Fairbanks	AK	64.84	-147.72
College Park	MD	38.98	-76.94
Springville	UT	40.17	-111.61
Natick	MA	42.28	-71.35
Massillon	OH	40.8	-81.52
Walla Walla	WA	46.06	-118.34
Florence	KY	39	-84.63
Andover	MN	45.23	-93.29
Hopkinsville	KY	36.87	-87.49
Laramie	WY	41.31	-105.59
Greenville	MS	33.41	-91.06
West Englewood	IL	41.78	-87.67
Bethel Park	PA	40.33	-80.04
Cookeville	TN	36.16	-85.5
Randolph	MA	42.16	-71.04
Oceanside	NY	40.64	-73.64
Danville	IL	40.12	-87.63
Montgomery Village	MD	39.18	-77.2
North Olmsted	OH	41.42	-81.92
Land O' Lakes	FL	28.22	-82.46
Richmond West	FL	25.61	-80.43
Watertown	MA	42.37	-71.18
Glastonbury	CT	41.71	-72.61
Westmont	CA	33.94	-118.3
Garfield	NJ	40.88	-74.11
Laguna Hills	CA	33.61	-117.71
West Bend	WI	43.43	-88.18
Willingboro	NJ	40.03	-74.87
Mundelein	IL	42.26	-88
Centereach	NY	40.86	-73.1
Mount Juliet	TN	36.2	-86.52
Naugatuck	CT	41.49	-73.05
San Luis	AZ	32.49	-114.78
Brighton Beach	NY	40.58	-73.96
Michigan City	IN	41.71	-86.9
Dania Beach	FL	26.05	-80.14
Lewiston Orchards	ID	46.38	-116.98
Lexington	MA	42.45	-71.22
Chatham	IL	41.74	-87.61
Navarre	FL	30.4	-86.86
Holly Springs	NC	35.65	-78.83
Shawnee	OK	35.33	-96.93
Brentwood Estates	TN	36.03	-86.78
Galesburg	IL	40.95	-90.37
Bowling Green	OH	41.37	-83.65
Des Moines	WA	47.4	-122.32
Wheat Ridge	CO	39.77	-105.08
Florence	AZ	33.03	-111.39
Gurnee	IL	42.37	-87.9
Myrtle Beach	SC	33.69	-78.89
Parkersburg	WV	39.27	-81.56
Miami Lakes	FL	25.91	-80.31
Saratoga	CA	37.26	-122.02
East Lake	FL	28.11	-82.69
Banning	CA	33.93	-116.88
Goleta	CA	34.44	-119.83
Lakeside	FL	30.13	-81.77
Long Branch	NJ	40.3	-73.99
Fair Oaks	CA	38.64	-121.27
Wayne	PA	40.04	-75.39
Lake Stevens	WA	48.02	-122.06
Dover	NH	43.2	-70.87
Radnor	PA	40.05	-75.36
Holladay	UT	40.67	-111.82
Herriman	UT	40.51	-112.03
South Kingstown	RI	41.45	-71.52
Estero	FL	26.44	-81.81
Ithaca	NY	42.44	-76.5
North Tonawanda	NY	43.04	-78.86
Brooklyn Center	MN	45.08	-93.33
Pikesville	MD	39.37	-76.72
New Iberia	LA	30	-91.82
Alamogordo	NM	32.9	-105.96
Parkville	MD	39.38	-76.54
Statesboro	GA	32.45	-81.78
Morgantown	WV	39.63	-79.96
Los Gatos	CA	37.23	-121.97
Matthews	NC	35.12	-80.72
Los Altos	CA	37.39	-122.11
Clearfield	UT	41.11	-112.03
Franklin	MA	42.08	-71.4
Owings Mills	MD	39.42	-76.78
Aiken	SC	33.56	-81.72
Plainfield	IN	39.7	-86.4
Helena	MT	46.59	-112.04
Ballwin	MO	38.6	-90.55
Manchester	CT	41.78	-72.52
Algonquin	IL	42.17	-88.29
Bel Air North	MD	39.55	-76.37
Newington	CT	41.7	-72.72
Westfield	NJ	40.66	-74.35
Santa Paula	CA	34.35	-119.06
Fallbrook	CA	33.38	-117.25
Eldersburg	MD	39.4	-76.95
Sherwood	AR	34.82	-92.22
Springfield Gardens	NY	40.66	-73.76
Lawrenceville	GA	33.96	-83.99
Springfield	VA	38.79	-77.19
Kaysville	UT	41.04	-111.94
Granger	IN	41.75	-86.11
Burlingame	CA	37.58	-122.37
Post Falls	ID	47.72	-116.95
Liberty	MO	39.25	-94.42
San Pablo	CA	37.96	-122.35
Savage	MN	44.78	-93.34
Poughkeepsie	NY	41.7	-73.92
Texarkana	AR	33.44	-94.04
North Royalton	OH	41.31	-81.72
Chicago Heights	IL	41.51	-87.64
Lebanon	TN	36.21	-86.29
Walnut	CA	34.02	-117.87
Madison Heights	MI	42.49	-83.11
DeLand	FL	29.03	-81.3
Cedar City	UT	37.68	-113.06
Parkland	FL	26.31	-80.24
West Warwick	RI	41.7	-71.52
Jamestown	NY	42.1	-79.24
New Bern	NC	35.11	-77.04
Rochester	NH	43.3	-70.98
Cleburne	TX	32.35	-97.39
Winter Park	FL	28.6	-81.34
Carney	MD	39.39	-76.52
Southlake	TX	32.94	-97.13
San Carlos	CA	37.51	-122.26
Woodstock	GA	34.1	-84.52
East Hill-Meridian	WA	47.41	-122.17
Niles	IL	42.02	-87.8
Laplace	LA	30.07	-90.48
Westchester	FL	25.75	-80.33
Atascadero	CA	35.49	-120.67
Kent	OH	41.15	-81.36
Gloucester	MA	42.61	-70.66
Nicholasville	KY	37.88	-84.57
Oak Park	MI	42.46	-83.18
Highland Park	IL	42.18	-87.8
Elizabethtown	KY	37.69	-85.86
Austintown	OH	41.1	-80.76
East Palo Alto	CA	37.47	-122.14
South Gate	MD	39.13	-76.63
Pueblo West	CO	38.35	-104.72
Port Chester	NY	41	-73.67
Princeton	NJ	40.35	-74.66
Fort Hood	TX	31.13	-97.78
LaGrange	GA	33.04	-85.03
Salem	NH	42.79	-71.2
Opelika	AL	32.65	-85.38
Rahway	NJ	40.61	-74.28
North Chicago	IL	42.33	-87.84
Middle Village	NY	40.72	-73.88
Morristown	TN	36.21	-83.29
Cheshire	CT	41.5	-72.9
Branford	CT	41.28	-72.82
Raytown	MO	39.01	-94.46
Fruit Cove	FL	30.11	-81.64
Port Huron	MI	42.97	-82.42
Tewksbury	MA	42.61	-71.23
Franklin Square	NY	40.71	-73.68
Oak Ridge	TN	36.01	-84.27
Southgate	MI	42.21	-83.19
East Haven	CT	41.28	-72.87
Upper Alton	IL	38.91	-90.15
Johnston	RI	41.82	-71.51
Atwater	CA	37.35	-120.61
West Falls Church	VA	38.86	-77.19
Williamsport	PA	41.24	-77
Duluth	GA	34	-84.14
Fort Bragg	NC	35.14	-79.01
Russellville	AR	35.28	-93.13
Sanford	NC	35.48	-79.18
Harker Heights	TX	31.08	-97.66
Voorhees	NJ	40.48	-74.48
Burbank	IL	41.73	-87.78
Marion	IN	40.56	-85.66
Granite City	IL	38.7	-90.15
Milford Mill	MD	39.35	-76.77
Lake in the Hills	IL	42.18	-88.33
Evans	GA	33.53	-82.13
O'Fallon	IL	38.59	-89.91
Fort Hamilton	NY	40.62	-74.03
Carlsbad	NM	32.42	-104.23
Ferry Pass	FL	30.51	-87.21
Kingman	AZ	35.19	-114.05
Orcutt	CA	34.87	-120.44
Henderson	KY	37.84	-87.59
Needham	MA	42.28	-71.23
Crown Point	IN	41.42	-87.37
Big Spring	TX	32.25	-101.48
Dracut	MA	42.67	-71.3
Schererville	IN	41.48	-87.45
Burton	MI	43	-83.62
Ridgecrest	CA	35.62	-117.67
Windsor	CT	41.85	-72.64
Eagle Pass	TX	28.71	-100.5
Agawam	MA	42.07	-72.61
Weatherford	TX	32.76	-97.8
West Elkridge	MD	39.21	-76.73
East Chicago	IN	41.64	-87.45
Redmond	OR	44.27	-121.17
Jacksonville	AR	34.87	-92.11
Socorro Mission Number 1 Colonia	TX	31.64	-106.29
Norwood	MA	42.19	-71.2
Northampton	MA	42.33	-72.64
Englewood	NJ	40.89	-73.97
Lake Magdalene	FL	28.07	-82.47
Perry Hall	MD	39.41	-76.46
Maryville	TN	35.76	-83.97
Hobart	IN	41.53	-87.26
Fresh Meadows	NY	40.73	-73.79
Mehlville	MO	38.51	-90.32
Greer	SC	34.94	-82.23
Lansing	IL	41.56	-87.54
Harrison	NY	40.97	-73.71
Monterey	CA	36.6	-121.89
West Islip	NY	40.71	-73.31
Desert Hot Springs	CA	33.96	-116.5
American Fork	UT	40.38	-111.8
Central	LA	30.55	-91.04
Newburgh	NY	41.5	-74.01
Chamblee	GA	33.89	-84.3
Millville	NJ	39.4	-75.04
North Andover	MA	42.7	-71.14
SeaTac	WA	47.45	-122.29
Elmira	NY	42.09	-76.81
Spring Valley	CA	32.74	-117
Stockbridge	GA	33.54	-84.23
Glen Ellyn	IL	41.88	-88.07
Monroeville	PA	40.42	-79.79
Benicia	CA	38.05	-122.16
Fredericksburg	VA	38.3	-77.46
Suisun	CA	38.24	-122.04
Aberdeen	SD	45.46	-98.49
Cranberry Township	PA	40.68	-80.11
Garfield Heights	OH	41.42	-81.61
South Chicago	IL	41.74	-87.55
Cornelius	NC	35.49	-80.86
Oakdale	MN	44.96	-92.96
Oak Forest	IL	41.6	-87.74
Garner	NC	35.71	-78.61
Drexel Hill	PA	39.95	-75.29
North Kingstown	RI	41.55	-71.47
Bella Vista	AR	36.48	-94.27
Melrose	MA	42.46	-71.07
Fitchburg	WI	42.96	-89.47
Gramercy Park	NY	40.74	-73.99
Wellesley	MA	42.3	-71.29
Enterprise	AL	31.32	-85.86
Winchester	NV	36.13	-115.12
Slidell	LA	30.28	-89.78
University Heights	NY	40.86	-73.91
West Springfield	MA	42.11	-72.62
Dodge City	KS	37.75	-100.02
Paragould	AR	36.06	-90.5
Maywood	CA	33.99	-118.19
Seguin	TX	29.57	-97.96
Shirley	NY	40.8	-72.87
Livingston	NJ	40.8	-74.31
Round Lake Beach	IL	42.37	-88.09
Frankfort	KY	38.2	-84.87
Sterling	VA	39.01	-77.43
Middletown	NY	41.45	-74.42
Fountain	CO	38.68	-104.7
Saratoga Springs	NY	43.08	-73.78
Kirkwood	MO	38.58	-90.41
Drexel Heights	AZ	32.14	-111.03
Deer Park	NY	40.76	-73.33
Lafayette	CO	39.99	-105.09
Fridley	MN	45.09	-93.26
West Scarborough	ME	43.57	-70.39
Queensbury	NY	43.38	-73.61
Rexburg	ID	43.83	-111.79
Wheeling	WV	40.06	-80.72
Shaker Heights	OH	41.47	-81.54
Mililani Town	HI	21.45	-158.02
Bergenfield	NJ	40.93	-74
Marshalltown	IA	42.05	-92.91
Tucker	GA	33.85	-84.22
Nutley	NJ	40.82	-74.16
Lake Jackson	TX	29.03	-95.43
Plum	PA	40.5	-79.75
Windsor	CA	38.55	-122.82
West Chicago	IL	41.88	-88.2
Allen Park	MI	42.26	-83.21
Wilmette	IL	42.07	-87.72
Imperial Beach	CA	32.58	-117.11
Glen Cove	NY	40.86	-73.63
Syracuse	UT	41.09	-112.06
Maryland Heights	MO	38.71	-90.43
Mason City	IA	43.15	-93.2
Crofton	MD	39	-76.69
Anderson	SC	34.5	-82.65
Eagle Mountain	UT	40.31	-112.01
College Point	NY	40.79	-73.85
Winchester	VA	39.19	-78.16
Lindenhurst	NY	40.69	-73.37
Spanaway	WA	47.1	-122.43
Belmont	CA	37.52	-122.28
Hunts Point	NY	40.81	-73.88
Holbrook	NY	40.81	-73.08
New London	CT	41.36	-72.1
Paso Robles	CA	35.63	-120.69
Tualatin	OR	45.38	-122.76
Fleming Island	FL	30.09	-81.72
Winona	MN	44.05	-91.64
Thomasville	NC	35.88	-80.08
Casselberry	FL	28.68	-81.33
Eureka	CA	40.8	-124.16
East Saint Louis	IL	38.62	-90.15
Garden City	KS	37.97	-100.87
Alton	IL	38.89	-90.18
Milton	MA	42.25	-71.07
University Park	FL	25.75	-80.37
Auburn	NY	42.93	-76.57
Williston	ND	48.15	-103.62
Paramus	NJ	40.94	-74.08
Back Mountain	PA	41.34	-76
West Milford	NJ	41.13	-74.37
Jeffersontown	KY	38.19	-85.56
Garden City	MI	42.33	-83.33
Horn Lake	MS	34.96	-90.03
Stoughton	MA	42.13	-71.1
Easton	PA	40.69	-75.22
Prairieville	LA	30.3	-90.97
Hyde Park	IL	41.79	-87.59
Dix Hills	NY	40.8	-73.34
Gladstone	MO	39.2	-94.55
Cutler Ridge	FL	25.58	-80.35
Independence	KY	38.94	-84.54
Watertown	NY	43.97	-75.91
Wooster	OH	40.81	-81.94
Bessemer	AL	33.4	-86.95
Merrimack	NH	42.87	-71.49
Lemon Grove	CA	32.74	-117.03
Kankakee	IL	41.12	-87.86
Wethersfield	CT	41.71	-72.65
Bristol	TN	36.6	-82.19
McHenry	IL	42.33	-88.27
Cibolo	TX	29.56	-98.23
Saugus	MA	42.46	-71.01
Stevens Point	WI	44.52	-89.57
West Linn	OR	45.37	-122.61
Superior	WI	46.72	-92.1
Tujunga	CA	34.25	-118.29
Greenville	TX	33.14	-96.11
Magna	UT	40.71	-112.1
Batavia	IL	41.85	-88.31
Cantonment	FL	30.61	-87.34
Danvers	MA	42.58	-70.93
Shoreview	MN	45.08	-93.15
Paradise	CA	39.76	-121.62
Fremont	NE	41.43	-96.5
Smithtown	NY	40.86	-73.2
Pearl	MS	32.27	-90.13
Mansfield City	CT	41.77	-72.23
Mercerville-Hamilton Square	NJ	40.23	-74.67
North Creek	WA	47.82	-122.18
Carbondale	IL	37.73	-89.22
Westport	CT	41.14	-73.36
Medina	OH	41.14	-81.86
Bay Shore	NY	40.73	-73.25
Kahului	HI	20.89	-156.47
Vernon Hills	IL	42.22	-87.98
Zionsville	IN	39.95	-86.26
Norco	CA	33.93	-117.55
Wasco	CA	35.59	-119.34
Mount Pleasant	WI	42.7	-87.86
Fortuna Foothills	AZ	32.66	-114.41
Barberton	OH	41.01	-81.61
Kingsville	TX	27.52	-97.86
Statesville	NC	35.78	-80.89
Plainview	NY	40.78	-73.47
Laurel	MD	39.1	-76.85
Carrollton	GA	33.58	-85.08
South Pasadena	CA	34.12	-118.15
Howard Beach	NY	40.66	-73.84
Englewood	IL	41.78	-87.65
Four Corners	FL	28.33	-81.65
South Laurel	MD	39.07	-76.85
Asheboro	NC	35.71	-79.81
Buenaventura Lakes	FL	28.34	-81.35
Clinton	IA	41.84	-90.19
Mount Pleasant	MI	43.6	-84.77
Twentynine Palms	CA	34.14	-116.05
Huntley	IL	42.17	-88.43
Pennsport	PA	39.93	-75.15
Xenia	OH	39.68	-83.93
Reisterstown	MD	39.47	-76.83
Green	OH	40.95	-81.48
Brawley	CA	32.98	-115.53
Yukon	OK	35.51	-97.76
Opportunity	WA	47.65	-117.24
Forest Hills	MI	42.96	-85.49
Lafayette	CA	37.89	-122.12
Ramsey	MN	45.26	-93.45
Suitland	MD	38.85	-76.92
Pleasure Ridge Park	KY	38.15	-85.86
Rosedale	NY	40.66	-73.74
New Lenox	IL	41.51	-87.97
Madison	MS	32.46	-90.12
Neenah	WI	44.19	-88.46
Alvin	TX	29.42	-95.24
Key West	FL	24.56	-81.78
Randolph	NJ	40.85	-74.58
Temple Terrace	FL	28.04	-82.39
Owatonna	MN	44.08	-93.23
Homewood	AL	33.47	-86.8
Sahuarita	AZ	31.96	-110.96
Maple Valley	WA	47.39	-122.05
Hazelwood	MO	38.77	-90.37
Troy	OH	40.04	-84.2
Lemoore	CA	36.3	-119.78
Mint Hill	NC	35.18	-80.65
Ridgewood	NJ	40.98	-74.12
Long Island City	NY	40.74	-73.95
Cabot	AR	34.97	-92.02
Reedley	CA	36.6	-119.45
Edgewood	MD	39.42	-76.29
Meadow Woods	FL	28.39	-81.37
South Portland	ME	43.64	-70.24
West Whittier-Los Nietos	CA	33.98	-118.07
Lebanon	PA	40.34	-76.41
Zanesville	OH	39.94	-82.01
Colleyville	TX	32.88	-97.16
Canton	GA	34.24	-84.49
Ossining	NY	41.16	-73.86
Salem	VA	37.29	-80.05
Burlington	IA	40.81	-91.11
Saratoga Springs	UT	40.35	-111.9
Melrose Park	IL	41.9	-87.86
Starkville	MS	33.45	-88.82
Lochearn	MD	39.34	-76.72
Chanhassen	MN	44.86	-93.53
Hercules	CA	38.02	-122.29
Galt	CA	38.25	-121.3
Prior Lake	MN	44.71	-93.42
Castlewood	CO	39.58	-104.9
Grandview	MO	38.89	-94.53
Clinton	MS	32.34	-90.32
Yarmouth	MA	41.71	-70.23
Sandusky	OH	41.45	-82.71
Balch Springs	TX	32.73	-96.62
White Bear Lake	MN	45.08	-93.01
Chaska	MN	44.79	-93.6
Harvey	IL	41.61	-87.65
Middle River	MD	39.33	-76.44
Woodstock	IL	42.31	-88.45
Ardmore	OK	34.17	-97.14
Lockport	IL	41.59	-88.06
Woodburn	OR	45.14	-122.86
Wyandotte	MI	42.21	-83.15
Mauldin	SC	34.78	-82.31
Belvidere	IL	42.26	-88.84
Moscow	ID	46.73	-117
Milford	MA	42.14	-71.52
West Memphis	AR	35.15	-90.18
Athens	OH	39.33	-82.1
Mercer Island	WA	47.57	-122.22
Bridgeton	NJ	39.43	-75.23
Maplewood	NJ	40.73	-74.27
Soledad	CA	36.42	-121.33
Farmington	CT	41.72	-72.83
Brownsburg	IN	39.84	-86.4
Saginaw Township North	MI	43.46	-84.01
Edwardsville	IL	38.81	-89.95
Riverside	OH	39.78	-84.12
Athens	AL	34.8	-86.97
Sanger	CA	36.71	-119.56
Westmont	IL	41.8	-87.98
Wakefield	MA	42.51	-71.07
San Fernando	CA	34.28	-118.44
Rockledge	FL	28.35	-80.73
Hastings	NE	40.59	-98.39
Cave Spring	VA	37.23	-80.01
North Tustin	CA	33.76	-117.79
Daphne	AL	30.6	-87.9
Whitehall Township	PA	40.67	-75.5
Paducah	KY	37.08	-88.6
Cliffside Park	NJ	40.82	-73.99
Elmwood Park	IL	41.92	-87.81
Vineyard	CA	38.46	-121.35
Lodi	NJ	40.88	-74.08
Hazleton	PA	40.96	-75.97
Coronado	CA	32.69	-117.18
Hillside	NY	40.71	-73.79
Eagle River	AK	61.32	-149.57
South Salt Lake	UT	40.72	-111.89
Paris	TX	33.66	-95.56
Northport	AL	33.23	-87.58
University Park	TX	32.85	-96.8
Uniondale	NY	40.7	-73.59
Ponca City	OK	36.71	-97.09
Muskego	WI	42.91	-88.14
Collinsville	IL	38.67	-89.98
Reading	MA	42.53	-71.1
Short Pump	VA	37.65	-77.61
Belmont	MA	42.4	-71.18
Dedham	MA	42.24	-71.17
De Pere	WI	44.45	-88.06
Caledonia	WI	42.81	-87.92
Inkster	MI	42.29	-83.31
Vincentown	NJ	39.93	-74.75
Bixby	OK	35.94	-95.88
Emporia	KS	38.4	-96.18
Fort Dodge	IA	42.5	-94.17
Walker	MI	43	-85.77
Palmetto Bay	FL	25.62	-80.32
Ottumwa	IA	41.02	-92.41
Junction City	KS	39.03	-96.83
Seal Beach	CA	33.74	-118.1
Tarpon Springs	FL	28.15	-82.76
Franklin	IN	39.48	-86.05
Herndon	VA	38.97	-77.39
Austin	MN	43.67	-92.97
Sachse	TX	32.98	-96.6
Sun City West	AZ	33.66	-112.34
Watauga	TX	32.86	-97.25
Burlington	MA	42.5	-71.2
San Benito	TX	26.13	-97.63
Freeport	IL	42.3	-89.62
Staunton	VA	38.15	-79.07
Selma	CA	36.57	-119.61
South Windsor	CT	41.82	-72.62
North Potomac	MD	39.08	-77.26
Homer Glen	IL	41.6	-87.94
Coral Terrace	FL	25.75	-80.3
Norfolk	NE	42.03	-97.42
Ridgeland	MS	32.43	-90.13
Scaggsville	MD	39.15	-76.9
Cudahy	CA	33.96	-118.19
Washington	UT	37.13	-113.51
New Smyrna Beach	FL	29.03	-80.93
South Plainfield	NJ	40.58	-74.41
Pasadena	MD	39.11	-76.57
Columbine	CO	39.59	-105.07
Greenbelt	MD	39	-76.88
South Riding	VA	38.92	-77.5
Citrus Park	FL	28.08	-82.57
Boca Del Mar	FL	26.35	-80.15
Newport	RI	41.49	-71.31
Norton Shores	MI	43.17	-86.26
Barstow Heights	CA	34.87	-117.06
Rockville Centre	NY	40.66	-73.64
Searcy	AR	35.25	-91.74
North Platte	NE	41.12	-100.77
Rolling Meadows	IL	42.08	-88.01
Carteret	NJ	40.58	-74.23
Immokalee	FL	26.42	-81.42
Woodlawn	IL	41.78	-87.6
Medford	NY	40.82	-73
Riverbank	CA	37.74	-120.94
Zion	IL	42.45	-87.83
Trotwood	OH	39.8	-84.31
North Haven	CT	41.39	-72.86
Summerlin South	NV	36.12	-115.33
Mahwah	NJ	41.09	-74.14
Loma Linda	CA	34.05	-117.26
Peekskill	NY	41.29	-73.92
Keystone	FL	28.16	-82.62
Baldwin	NY	40.66	-73.61
Fairfax	VA	38.85	-77.31
Maywood	IL	41.88	-87.84
Sebastian	FL	27.82	-80.47
Holt	MI	42.64	-84.52
Muscatine	IA	41.42	-91.04
Elk River	MN	45.3	-93.57
Rock Springs	WY	41.59	-109.2
Golden Gate	FL	26.19	-81.7
Corsicana	TX	32.1	-96.47
Hialeah Gardens	FL	25.87	-80.32
Waverly	MI	42.74	-84.62
Hunt Valley	MD	39.5	-76.64
Fuquay-Varina	NC	35.58	-78.8
Fountain Hills	AZ	33.61	-111.72
Forest Grove	OR	45.52	-123.11
Unionport	NY	40.83	-73.85
Champlin	MN	45.19	-93.4
South Portland Gardens	ME	43.64	-70.32
Centerville	OH	39.63	-84.16
Bloomington	CA	34.07	-117.4
Bainbridge Island	WA	47.63	-122.52
Morrisville	NC	35.82	-78.83
Marshall	TX	32.54	-94.37
Watertown	WI	43.19	-88.73
Kernersville	NC	36.12	-80.07
Dickinson	ND	46.88	-102.79
Old Bridge	NJ	40.41	-74.37
Fort Washington	MD	38.71	-77.02
Dinuba	CA	36.54	-119.39
Van Nest	NY	40.85	-73.86
Barstow	CA	34.9	-117.02
Fairland	MD	39.08	-76.96
Brookings	SD	44.31	-96.8
Blue Island	IL	41.66	-87.68
Faribault	MN	44.29	-93.27
Baileys Crossroads	VA	38.85	-77.13
Eagle	ID	43.7	-116.35
Norland	FL	25.95	-80.21
Scotch Plains	NJ	40.66	-74.39
Glenville	OH	41.53	-81.62
El Cerrito	CA	37.92	-122.31
Brandon	MS	32.27	-89.99
Derby	KS	37.55	-97.27
Graham	WA	47.05	-122.29
Ilchester	MD	39.25	-76.76
Bayonet Point	FL	28.33	-82.68
Easton	MA	42.02	-71.13
Loves Park	IL	42.32	-89.06
Avon Lake	OH	41.51	-82.03
San Lorenzo	CA	37.68	-122.12
Morton Grove	IL	42.04	-87.78
Kingston	NY	41.93	-74
McDonough	GA	33.45	-84.15
Romulus	MI	42.22	-83.4
Rosemount	MN	44.74	-93.13
Mansfield	MA	42.03	-71.22
Laguna Beach	CA	33.54	-117.78
Springfield	PA	39.93	-75.32
Bellview	FL	30.46	-87.31
Terrytown	LA	29.91	-90.03
Crestview	FL	30.76	-86.57
Keene	NH	42.93	-72.28
Greenwood	SC	34.2	-82.16
Gallup	NM	35.53	-108.74
South Old Bridge	NJ	40.41	-74.35
Duncan	OK	34.5	-97.96
Griffin	GA	33.25	-84.26
Dolton	IL	41.64	-87.61
Webster Groves	MO	38.59	-90.36
Belton	MO	38.81	-94.53
Columbus	MS	33.5	-88.43
Denison	TX	33.76	-96.54
East Elmhurst	NY	40.76	-73.87
Kerrville	TX	30.05	-99.14
Pooler	GA	32.12	-81.25
Mequon	WI	43.22	-88.03
Vicksburg	MS	32.35	-90.88
Wright	FL	30.46	-86.64
Morrisania	NY	40.83	-73.91
Palm City	FL	27.17	-80.27
Middleborough	MA	41.89	-70.91
Arnold	MD	39.03	-76.5
Isla Vista	CA	34.41	-119.86
Vero Beach South	FL	27.62	-80.41
Van Buren	AR	35.44	-94.35
East Peoria	IL	40.67	-89.58
Landover	MD	38.93	-76.9
Windham	CT	41.7	-72.16
Jacksonville Beach	FL	30.29	-81.39
Calabasas	CA	34.16	-118.64
Solon	OH	41.39	-81.44
Chantilly	VA	38.89	-77.43
Candler-McAfee	GA	33.73	-84.27
Roselle	IL	41.98	-88.08
Copiague	NY	40.68	-73.4
Munster	IN	41.56	-87.51
Ladera Ranch	CA	33.57	-117.64
Lisle	IL	41.8	-88.07
Picnic Point-North Lynnwood	WA	47.86	-122.29
East Naples	FL	26.14	-81.77
Crystal	MN	45.03	-93.36
Cloverleaf	TX	29.78	-95.17
Dixiana	AL	33.74	-86.65
Highland	IN	41.55	-87.45
Machesney Park	IL	42.35	-89.04
Morgan Park	IL	41.69	-87.67
Noe Valley	CA	37.75	-122.43
East Tremont	NY	40.85	-73.89
Pelham	AL	33.29	-86.81
Auburn	ME	44.1	-70.23
Tremont	NY	40.85	-73.91
Lincolnia	VA	38.82	-77.14
Kiryas Joel	NY	41.34	-74.17
Valinda	CA	34.05	-117.94
Marysville	OH	40.24	-83.37
Haines City	FL	28.11	-81.62
Columbus	NE	41.43	-97.37
Bristol	RI	41.68	-71.27
Millbrae	CA	37.6	-122.39
Newberg	OR	45.3	-122.97
The Crossings	FL	25.67	-80.4
Valley Station	KY	38.11	-85.87
Lennox	CA	33.94	-118.35
East Lake-Orient Park	FL	27.98	-82.38
Farmington	MN	44.64	-93.14
Wilsonville	OR	45.3	-122.77
Hutto	TX	30.54	-97.55
Bloomingdale	FL	27.89	-82.24
West Odessa	TX	31.84	-102.5
Inglewood-Finn Hill	WA	47.72	-122.23
Oak Harbor	WA	48.29	-122.64
‘Ewa Gentry	HI	21.34	-158.03
Oak Ridge	FL	28.47	-81.42
Rosemont	CA	38.55	-121.36
Auburn Hills	MI	42.69	-83.23
Pottstown	PA	40.25	-75.65
Leisure City	FL	25.5	-80.43
West Puente Valley	CA	34.05	-117.97
Maple Heights	OH	41.42	-81.57
Willoughby	OH	41.64	-81.41
Benbrook	TX	32.67	-97.46
Cranford	NJ	40.66	-74.3
Garden City	NY	40.73	-73.63
Farmington	UT	40.98	-111.89
Wasco	IL	41.94	-88.4
Hastings	MN	44.74	-92.85
Avon	OH	41.45	-82.04
Visitacion Valley	CA	37.72	-122.4
North Augusta	SC	33.5	-81.97
Guilford	CT	41.29	-72.68
Cottage Lake	WA	47.74	-122.08
Corcoran	CA	36.1	-119.56
Melrose	NY	40.82	-73.91
East Patchogue	NY	40.77	-73
West Springfield	VA	38.77	-77.22
Hudson	OH	41.24	-81.44
Port Hueneme	CA	34.15	-119.2
Holiday	FL	28.19	-82.74
Near South Side	IL	41.86	-87.62
Radcliff	KY	37.84	-85.95
Hopewell	VA	37.3	-77.29
New Castle	PA	41	-80.35
Grand Boulevard	IL	41.81	-87.62
South Elgin	IL	41.99	-88.29
Prichard	AL	30.74	-88.08
New Brighton	MN	45.07	-93.2
Anniston	AL	33.66	-85.83
Palm Springs	FL	26.64	-80.1
Ruston	LA	32.52	-92.64
Wilmington	MA	42.55	-71.17
Midlothian	TX	32.48	-96.99
Oxford	MS	34.37	-89.52
Oakdale	CA	37.77	-120.85
Darien	IL	41.75	-87.97
Bloomingdale	IL	41.96	-88.08
Venice	FL	27.1	-82.45
Ludlow	MA	42.16	-72.48
South Bradenton	FL	27.46	-82.58
Hillside	NJ	40.7	-74.23
North Plainfield	NJ	40.63	-74.43
Acworth	GA	34.07	-84.68
Pascagoula	MS	30.37	-88.56
Sunny Isles Beach	FL	25.95	-80.12
Roseburg	OR	43.22	-123.34
Oxford	OH	39.51	-84.75
Merrick	NY	40.66	-73.55
Somerset	NJ	40.5	-74.49
Moses Lake	WA	47.13	-119.28
Saginaw	TX	32.86	-97.36
Greater Northdale	FL	28.11	-82.53
Northdale	FL	28.09	-82.51
Summit	NJ	40.72	-74.36
Watertown	SD	44.9	-97.12
Alliance	OH	40.92	-81.11
LaPorte	IN	41.61	-86.72
Kalispell	MT	48.2	-114.31
South Holland	IL	41.6	-87.61
Princeton	FL	25.54	-80.41
Kenmore	WA	47.76	-122.24
Del City	OK	35.44	-97.44
Derry	NH	42.88	-71.33
Hamtramck	MI	42.39	-83.05
Great Kills	NY	40.55	-74.15
Wekiwa Springs	FL	28.7	-81.43
Leesburg	FL	28.81	-81.88
Duarte	CA	34.14	-117.98
Converse	TX	29.52	-98.32
Villa Park	IL	41.89	-87.99
Decatur	GA	33.77	-84.3
Park Forest	IL	41.49	-87.67
Christiansburg	VA	37.13	-80.41
Jurupa Valley	CA	33.99	-117.52
Ashland	CA	37.69	-122.11
West and East Lealman	FL	27.82	-82.69
Farragut	TN	35.88	-84.15
La Porte	IN	41.61	-86.71
Prairie Village	KS	38.99	-94.63
Smithfield	RI	41.92	-71.55
Clarksville	IN	38.3	-85.76
Wadsworth	OH	41.03	-81.73
Camas	WA	45.59	-122.4
Fort Walton Beach	FL	30.42	-86.62
Geneva	IL	41.89	-88.31
Brent	FL	30.47	-87.24
South Euclid	OH	41.52	-81.52
Brushy Creek	TX	30.51	-97.74
Windsor	CO	40.48	-104.9
Westchase	FL	28.06	-82.61
Sugar Hill	GA	34.11	-84.03
Chillicothe	OH	39.33	-82.98
South Lake Tahoe	CA	38.93	-119.98
Anthem	AZ	33.87	-112.15
West Carson	CA	33.82	-118.29
Massapequa	NY	40.68	-73.47
Canton	MA	42.16	-71.14
Roselle	NJ	40.65	-74.26
Lincoln	RI	41.92	-71.43
Lumberton	NC	34.62	-79.01
Taylors	SC	34.92	-82.3
Yucca Valley	CA	34.11	-116.43
Westford	MA	42.58	-71.44
Edgewater	FL	28.99	-80.9
Allison Park	PA	40.56	-79.96
Bay Point	CA	38.03	-121.96
Portsmouth	NH	43.08	-70.76
Sedalia	MO	38.7	-93.23
Naples	FL	26.14	-81.8
Patterson	CA	37.47	-121.13
Greenfield	IN	39.79	-85.77
Waynesboro	VA	38.07	-78.89
Albertville	AL	34.27	-86.21
Stoneham	MA	42.48	-71.1
Perrysburg	OH	41.56	-83.63
Erie	CO	40.05	-105.05
Klamath Falls	OR	42.22	-121.78
Clinton	UT	41.14	-112.05
Green Valley	AZ	31.85	-110.99
Evans	CO	40.38	-104.69
Mandan	ND	46.83	-100.89
Winchester	MA	42.45	-71.14
Okemos	MI	42.72	-84.43
Arnold	MO	38.43	-90.38
East Moline	IL	41.5	-90.44
West Pensacola	FL	30.43	-87.28
Kinston	NC	35.26	-77.58
Shelbyville	TN	35.48	-86.46
Marquette	MI	46.54	-87.4
Fairfield Heights	IN	39.83	-86.38
Biddeford	ME	43.49	-70.45
Golden Valley	MN	45.01	-93.35
Canyon Lake	TX	29.88	-98.26
Oxford	AL	33.61	-85.83
South Milwaukee	WI	42.91	-87.86
Marina	CA	36.68	-121.8
Mukilteo	WA	47.94	-122.3
Rancho San Diego	CA	32.75	-116.94
Charleston	IL	39.5	-88.18
Bedford	NH	42.95	-71.52
Carrboro	NC	35.91	-79.08
Crest Hill	IL	41.55	-88.1
Saint Andrews	SC	34.05	-81.13
Ashland	KY	38.48	-82.64
Hays	KS	38.88	-99.33
Ferguson	MO	38.74	-90.31
Conway	SC	33.84	-79.05
Laurelton	NY	40.67	-73.75
Lino Lakes	MN	45.16	-93.09
West Lake Stevens	WA	47.99	-122.1
New Hope	MN	45.04	-93.39
Palm River-Clair Mel	FL	27.92	-82.38
Trussville	AL	33.62	-86.61
Woodrow	NY	40.54	-74.2
Corinth	TX	33.15	-97.06
Mountlake Terrace	WA	47.79	-122.31
Chester	VA	37.36	-77.44
Nixa	MO	37.04	-93.29
East Ridge	TN	35.01	-85.25
Plainview	TX	34.18	-101.71
Grayslake	IL	42.34	-88.04
Agoura Hills	CA	34.14	-118.77
Acton	MA	42.49	-71.43
Sanford	ME	43.44	-70.77
Silver Firs	WA	47.87	-122.16
Hauppauge	NY	40.83	-73.2
Kīhei	HI	20.76	-156.45
South El Monte	CA	34.05	-118.05
Arvin	CA	35.21	-118.83
Johnston	IA	41.67	-93.7
Gardner	KS	38.81	-94.93
Lathrop	CA	37.82	-121.28
Ashland	OR	42.19	-122.71
Sidney	OH	40.28	-84.16
Birmingham	MI	42.55	-83.21
Sweetwater	FL	25.76	-80.37
Milwaukie	OR	45.45	-122.64
East Millcreek	UT	40.7	-111.81
Grand Island	NY	43.03	-78.96
Union City	GA	33.59	-84.54
Woodlawn	VA	38.72	-77.13
Piqua	OH	40.14	-84.24
Lomita	CA	33.79	-118.32
Cockeysville	MD	39.48	-76.64
Easley	SC	34.83	-82.6
New Springville	NY	40.59	-74.16
Pleasantville	NJ	39.39	-74.52
Liberal	KS	37.04	-100.92
Palisades Park	NJ	40.85	-74
Jenks	OK	36.02	-95.97
Simpsonville	SC	34.74	-82.25
Latham	NY	42.75	-73.76
Darien	CT	41.08	-73.47
Pleasant Prairie	WI	42.55	-87.93
Mountain Brook	AL	33.5	-86.75
Chambersburg	PA	39.94	-77.66
Adrian	MI	41.9	-84.04
West Melbourne	FL	28.07	-80.65
East Garfield Park	IL	41.88	-87.7
Rotterdam	NY	42.79	-73.97
Lakeside	CA	32.86	-116.92
Bethany	OR	45.56	-122.87
Lake Worth Corridor	FL	26.62	-80.1
Winter Gardens	CA	32.83	-116.93
Lockport	NY	43.17	-78.69
Lebanon	OH	39.44	-84.2
Wade Hampton	SC	34.9	-82.33
Murphy	TX	33.02	-96.61
Coralville	IA	41.68	-91.58
Ensley	FL	30.52	-87.27
Sapulpa	OK	36	-96.11
American Canyon	CA	38.17	-122.26
South San Jose Hills	CA	34.01	-117.9
Belton	TX	31.06	-97.46
Agoura	CA	34.14	-118.74
Bayville	NJ	39.91	-74.15
Arbutus	MD	39.25	-76.7
Hammond	LA	30.5	-90.46
Libertyville	IL	42.28	-87.95
Pittsburg	KS	37.41	-94.7
Portsmouth	OH	38.73	-83
Granite Bay	CA	38.76	-121.16
Louisville	CO	39.98	-105.13
Northfield	MN	44.46	-93.16
Rocky River	OH	41.48	-81.84
Raymore	MO	38.8	-94.45
Middletown	DE	39.45	-75.72
Havelock	NC	34.88	-76.9
Harvey	LA	29.9	-90.08
Gardner	MA	42.58	-72
Golden	CO	39.76	-105.22
Douglas	IL	41.83	-87.62
Cartersville	GA	34.17	-84.8
Ashland	OH	40.87	-82.32
Oakleaf Plantation	FL	30.17	-81.84
Affton	MO	38.55	-90.33
Ramona	CA	33.04	-116.87
Cambria Heights	NY	40.69	-73.74
Elmwood Park	NJ	40.9	-74.12
Elko	NV	40.83	-115.76
Hollis	NY	40.71	-73.77
Brooklyn Heights	NY	40.7	-73.99
Nogales	AZ	31.34	-110.93
Parma Heights	OH	41.39	-81.76
La Cañada Flintridge	CA	34.2	-118.19
Mustang	OK	35.38	-97.72
Rose Hill	VA	38.79	-77.11
East Northport	NY	40.88	-73.32
Glen Avon	CA	34.01	-117.48
Sulphur	LA	30.24	-93.38
Shelby	NC	35.29	-81.54
Montville Center	CT	41.48	-72.15
Ferndale	MI	42.46	-83.13
South Saint Paul	MN	44.89	-93.03
Lynn Haven	FL	30.25	-85.65
Lents	OR	45.48	-122.57
Lake Ronkonkoma	NY	40.84	-73.13
Lexington	SC	33.98	-81.24
Murrysville	PA	40.43	-79.7
Cumberland	MD	39.65	-78.76
Stephenville	TX	32.22	-98.2
Oregon	OH	41.64	-83.49
Eastmont	WA	47.9	-122.18
Monroe	MI	41.92	-83.4
Coconut Grove	FL	25.71	-80.26
West Mifflin	PA	40.36	-79.87
Mill Creek	WA	47.86	-122.2
Pace	FL	30.6	-87.16
Miamisburg	OH	39.64	-84.29
Palm Valley	FL	30.18	-81.39
Rolla	MO	37.95	-91.77
Tukwila	WA	47.47	-122.26
DeBary	FL	28.88	-81.31
Lyndhurst	NJ	40.81	-74.12
Lake Zurich	IL	42.2	-88.09
Germantown	WI	43.23	-88.11
Bryant	AR	34.6	-92.49
Eustis	FL	28.85	-81.69
Universal City	TX	29.55	-98.29
Newburg	KY	38.16	-85.66
Johnstown	PA	40.33	-78.92
Socastee	SC	33.68	-79
Ypsilanti	MI	42.24	-83.61
North Bellmore	NY	40.69	-73.53
King of Prussia	PA	40.09	-75.4
Hayesville	OR	44.99	-122.98
Warrensburg	MO	38.76	-93.74
Mokena	IL	41.53	-87.89
Norwood	OH	39.16	-84.46
Mariners Harbor	NY	40.64	-74.16
Bonney Lake	WA	47.18	-122.19
Dickinson	TX	29.46	-95.05
Clifton	CO	39.09	-108.45
Lealman	FL	27.82	-82.68
Hermosa Beach	CA	33.86	-118.4
Selden	NY	40.87	-73.04
Clemmons	NC	36.02	-80.38
West Chester	PA	39.96	-75.61
Evergreen Park	IL	41.72	-87.7
Southbury	CT	41.48	-73.21
Baldwin	PA	40.34	-79.98
Marblehead	MA	42.5	-70.86
Norton	MA	41.97	-71.19
Plattsburgh	NY	44.7	-73.45
North Salt Lake	UT	40.85	-111.91
Sand Springs	OK	36.14	-96.11
Painesville	OH	41.72	-81.25
Greenfield	MA	42.59	-72.6
Pickerington	OH	39.88	-82.75
New Canaan	CT	41.15	-73.49
Albany	CA	37.89	-122.3
Snellville	GA	33.86	-84.02
Sparta	NJ	41.03	-74.64
Columbia Heights	MN	45.04	-93.26
Holtsville	NY	40.82	-73.05
Salmon Creek	WA	45.71	-122.65
La Crescenta-Montrose	CA	34.23	-118.24
Spanish Lake	MO	38.79	-90.22
Willmar	MN	45.12	-95.04
Tysons Corner	VA	38.92	-77.23
Forest Lake	MN	45.28	-92.99
Bethany	OK	35.52	-97.63
Sun City	CA	33.71	-117.2
Montclair	VA	38.61	-77.34
Lynbrook	NY	40.65	-73.67
Orchards	WA	45.67	-122.56
Eastchester	NY	40.96	-73.81
Payson	UT	40.04	-111.73
West Saint Paul	MN	44.92	-93.1
Madisonville	KY	37.33	-87.5
Ives Estates	FL	25.96	-80.18
Selma	AL	32.41	-87.02
Papillion	NE	41.15	-96.04
Montgomery	IL	41.73	-88.35
Badger	AK	64.8	-147.53
Seymour	IN	38.96	-85.89
Lake Shore	MD	39.11	-76.48
McKeesport	PA	40.35	-79.86
Pinecrest	FL	25.67	-80.31
Weirton Heights	WV	40.41	-80.54
Port Angeles	WA	48.12	-123.43
Hazel Dell	WA	45.67	-122.66
Angleton	TX	29.17	-95.43
Fernley	NV	39.61	-119.25
Alice	TX	27.75	-98.07
Lake Forest	IL	42.26	-87.84
Battle Ground	WA	45.78	-122.53
Dixon	CA	38.45	-121.82
Forest Park	GA	33.62	-84.37
Mamaroneck	NY	40.95	-73.73
Homewood	IL	41.56	-87.67
Bear	DE	39.63	-75.66
Bayou Cane	LA	29.62	-90.75
Orange	TX	30.09	-93.74
Alsip	IL	41.67	-87.74
Lutz	FL	28.15	-82.46
Green Haven	MD	39.14	-76.55
Lexington	NC	35.82	-80.25
Bellwood	IL	41.88	-87.88
Clayton	NC	35.65	-78.46
Central Falls	RI	41.89	-71.39
Sun Valley	NV	39.6	-119.78
Horizon City	TX	31.69	-106.21
Sherwood	OR	45.36	-122.84
Waterford	CT	41.34	-72.14
Orinda	CA	37.88	-122.18
Pinole	CA	38	-122.3
Woodbridge	NJ	40.56	-74.28
Sun City Center	FL	27.72	-82.35
Rosedale	MD	39.32	-76.52
Altamont	OR	42.21	-121.74
Howard	WI	44.54	-88.09
Alamo	TX	26.18	-98.12
Broadview Heights	OH	41.31	-81.69
Upper Saint Clair	PA	40.34	-80.08
Haslett	MI	42.75	-84.4
West Elsdon	IL	41.79	-87.72
Newton	KS	38.05	-97.35
Glassboro	NJ	39.7	-75.11
Altus	OK	34.64	-99.33
Blythe	CA	33.61	-114.6
Silverdale	WA	47.64	-122.69
Covington	WA	47.36	-122.12
Matteson	IL	41.5	-87.71
Tumwater	WA	47.01	-122.91
Old Jamestown	MO	38.83	-90.29
Weirton	WV	40.42	-80.59
White Oak	OH	39.21	-84.6
Carlisle	PA	40.2	-77.19
Mineola	NY	40.75	-73.64
Shelbyville	IN	39.52	-85.78
Tullahoma	TN	35.36	-86.21
Ozark	MO	37.02	-93.21
Secaucus	NJ	40.79	-74.06
Jacksonville	IL	39.73	-90.23
Fairwood	WA	47.45	-122.16
Madison	CT	41.28	-72.6
Camp Springs	MD	38.8	-76.91
Ronkonkoma	NY	40.82	-73.11
Saco	ME	43.5	-70.44
Maple Shade	NJ	39.95	-74.99
Hawthorne	NJ	40.95	-74.15
Fresno	TX	29.54	-95.45
East Massapequa	NY	40.67	-73.44
Amherst Center	MA	42.38	-72.52
Montrose	CO	38.48	-107.88
Brownwood	TX	31.71	-98.99
Southbridge	MA	42.08	-72.03
Deerfield	IL	42.17	-87.84
Castaic	CA	34.49	-118.62
Ennis	TX	32.33	-96.63
Ellensburg	WA	47	-120.55
Claremore	OK	36.31	-95.62
Waukee	IA	41.61	-93.89
Jasmine Estates	FL	28.29	-82.69
Melville	NY	40.79	-73.42
Kew Gardens	NY	40.71	-73.83
Middleton	WI	43.1	-89.5
Bartow	FL	27.9	-81.84
Sylvania	OH	41.72	-83.71
Rio Rico	AZ	31.47	-110.98
Murray	KY	36.61	-88.31
Arlington	WA	48.2	-122.13
North Druid Hills	GA	33.82	-84.31
Brookfield	IL	41.82	-87.85
North Bay Shore	NY	40.74	-73.26
Milledgeville	GA	33.08	-83.23
Stillwater	MN	45.06	-92.81
Cortland	NY	42.6	-76.18
Berea	OH	41.37	-81.85
Twinsburg	OH	41.31	-81.44
Wantagh	NY	40.68	-73.51
West Hempstead	NY	40.7	-73.65
Ansonia	CT	41.35	-73.08
Troy	AL	31.81	-85.97
Mayfield Heights	OH	41.52	-81.46
Laurel	MS	31.69	-89.13
Syosset	NY	40.83	-73.5
Brook Park	OH	41.4	-81.8
Union Hill-Novelty Hill	WA	47.68	-122.03
Erlanger	KY	39.02	-84.6
Rossville	NY	40.56	-74.21
South Burlington	VT	44.47	-73.17
Mount Greenwood	IL	41.7	-87.71
Casa de Oro-Mount Helix	CA	32.76	-116.97
Langley Park	MD	38.99	-76.98
Brigham City	UT	41.51	-112.02
Thomasville	GA	30.84	-83.98
Fairmont	WV	39.49	-80.14
Fairhope	AL	30.52	-87.9
Greater Upper Marlboro	MD	38.83	-76.75
Frederickson	WA	47.1	-122.36
Iselin	NJ	40.58	-74.32
Suwanee	GA	34.05	-84.07
Whitehall	OH	39.97	-82.89
Rutherford	NJ	40.83	-74.11
Islip	NY	40.73	-73.21
Forest Park	OH	39.29	-84.5
Westminster	MD	39.58	-77
Frankfort	IL	41.5	-87.85
Niles	OH	41.18	-80.77
Marshfield	WI	44.67	-90.17
Lorton	VA	38.7	-77.23
Morristown	NJ	40.8	-74.48
Gautier	MS	30.39	-88.61
Bourbonnais	IL	41.15	-87.89
Goodings Grove	IL	41.63	-87.93
Macomb	IL	40.46	-90.67
Point Pleasant	NJ	40.08	-74.07
Bellaire	TX	29.71	-95.46
El Reno	OK	35.53	-97.96
Chowchilla	CA	37.12	-120.26
Mead Valley	CA	33.83	-117.3
Hyattsville	MD	38.96	-76.95
Happy Valley	OR	45.45	-122.53
Augusta	ME	44.31	-69.78
Onalaska	WI	43.88	-91.24
Round Lake	IL	42.35	-88.09
Stafford	TX	29.62	-95.56
Yorkville	IL	41.64	-88.45
Winchester	KY	37.99	-84.18
North Ogden	UT	41.31	-111.96
Bensenville	IL	41.96	-87.94
Forney	TX	32.75	-96.47
Monsey	NY	41.11	-74.07
Fern Creek	KY	38.16	-85.59
Shenandoah	LA	30.4	-91
El Dorado	AR	33.21	-92.67
Trenton	MI	42.14	-83.18
Ashtabula	OH	41.87	-80.79
Natchitoches	LA	31.76	-93.09
Cudahy	WI	42.96	-87.86
Dover	NJ	40.88	-74.56
Ottawa	IL	41.35	-88.84
Shafter	CA	35.5	-119.27
Amesbury	MA	42.86	-70.93
Franklin Park	IL	41.94	-87.87
Meadowbrook	VA	37.45	-77.47
McAlester	OK	34.93	-95.77
Punta Gorda Isles	FL	26.92	-82.08
Palestine	TX	31.76	-95.63
Sherrelwood	CO	39.84	-105
Creve Coeur	MO	38.66	-90.42
Ballenger Creek	MD	39.37	-77.44
Cinco Ranch	TX	29.74	-95.76
Helena	AL	33.3	-86.84
Palmer	MA	42.16	-72.33
Belle Glade	FL	26.68	-80.67
Makakilo	HI	21.35	-158.09
Franconia	VA	38.78	-77.15
Eastlake	OH	41.65	-81.45
Manchester	MO	38.6	-90.51
Cameron Park	CA	38.67	-120.99
Steubenville	OH	40.37	-80.63
Springboro	OH	39.55	-84.23
Wallingford Center	CT	41.45	-72.82
Lanham-Seabrook	MD	38.97	-76.85
Clark-Fulton	OH	41.46	-81.71
Farmington	MO	37.78	-90.42
Pampa	TX	35.54	-100.96
Somerset	MA	41.77	-71.13
Florida Ridge	FL	27.58	-80.39
Five Corners	WA	45.68	-122.58
Boone	NC	36.22	-81.67
Seminole	FL	27.84	-82.79
Punta Gorda	FL	26.93	-82.05
Rosamond	CA	34.86	-118.16
Cutler	FL	25.62	-80.31
Mattoon	IL	39.48	-88.37
Arroyo Grande	CA	35.12	-120.59
Monroe	WA	47.86	-121.97
Rancho Mirage	CA	33.74	-116.41
Limerick	PA	40.23	-75.52
Wilton	CT	41.2	-73.44
Huntington	NY	40.87	-73.43
Ojus	FL	25.95	-80.15
Santa Fe Springs	CA	33.95	-118.09
Vincennes	IN	38.68	-87.53
Amsterdam	NY	42.94	-74.19
Durango	CO	37.28	-107.88
Dumont	NJ	40.94	-74
Hanahan	SC	32.92	-80.02
Central Point	OR	42.38	-122.92
Highland	UT	40.43	-111.79
Elizabeth City	NC	36.29	-76.25
Newburyport	MA	42.81	-70.88
Rockland	MA	42.13	-70.92
Westbrook	ME	43.68	-70.37
St. Marys	GA	30.73	-81.55
Cary	IL	42.21	-88.24
Lackawanna	NY	42.83	-78.82
Westerly	RI	41.38	-71.83
Maumelle	AR	34.87	-92.4
Leland	NC	34.26	-78.04
Wisconsin Rapids	WI	44.38	-89.82
Lenoir	NC	35.91	-81.54
North Massapequa	NY	40.7	-73.46
Scarsdale	NY	41.01	-73.78
Nanuet	NY	41.09	-74.01
Gretna	LA	29.91	-90.05
Sheridan	WY	44.8	-106.96
North Amityville	NY	40.7	-73.43
Arcata	CA	40.87	-124.08
Hannibal	MO	39.71	-91.36
Wahiawā	HI	21.5	-158.02
Colonial Heights	VA	37.27	-77.41
Marion	IL	37.73	-88.93
Colonia	NJ	40.57	-74.3
Logansport	IN	40.75	-86.36
Oswego	NY	43.46	-76.51
Linda	CA	39.13	-121.55
Tinton Falls	NJ	40.3	-74.1
Godfrey	IL	38.96	-90.19
Portsmouth	RI	41.6	-71.25
West Garfield Park	IL	41.88	-87.73
Willimantic	CT	41.71	-72.21
Calverton	MD	39.06	-76.94
Oxon Hill	MD	38.8	-76.99
Takoma Park	MD	38.98	-77.01
Wallingford	CT	41.46	-72.82
Sycamore	IL	41.99	-88.69
Cocoa	FL	28.39	-80.74
Martinsburg	WV	39.46	-77.96
Marco Island	FL	25.94	-81.72
Tiffin	OH	41.11	-83.18
Albert Lea	MN	43.65	-93.37
South Hadley	MA	42.26	-72.57
Shaw	DC	38.91	-77.02
Ocean Springs	MS	30.41	-88.83
Hinsdale	IL	41.8	-87.94
New Castle	IN	39.93	-85.37
Winthrop	MA	42.38	-70.98
Lindenwold	NJ	39.82	-75
Kenwood	IL	41.81	-87.6
Bay City	TX	28.98	-95.97
Hopkins	MN	44.92	-93.46
Allendale	MI	42.97	-85.95
Menasha	WI	44.2	-88.45
Palos Hills	IL	41.7	-87.82
Prunedale	CA	36.78	-121.67
Culpeper	VA	38.47	-78
Stevenson Ranch	CA	34.39	-118.57
South Houston	TX	29.66	-95.24
Kirksville	MO	40.19	-92.58
Tallmadge	OH	41.1	-81.44
North Babylon	NY	40.72	-73.32
Mesquite	NV	36.81	-114.07
New Philadelphia	OH	40.49	-81.45
Saint Matthews	KY	38.25	-85.66
Maitland	FL	28.63	-81.36
North Aurora	IL	41.81	-88.33
Safety Harbor	FL	27.99	-82.69
North Canton	OH	40.88	-81.4
East Hemet	CA	33.74	-116.94
White Oak	MD	39.04	-76.99
Radford	VA	37.13	-80.58
Tillmans Corner	AL	30.59	-88.17
Detroit-Shoreway	OH	41.48	-81.73
Anoka	MN	45.2	-93.39
East Cleveland	OH	41.53	-81.58
Sudbury	MA	42.38	-71.42
Plainville	CT	41.67	-72.86
Ada	OK	34.77	-96.68
Middletown	RI	41.55	-71.29
Glassmanor	MD	38.82	-77
South Orange	NJ	40.75	-74.26
Idylwood	VA	38.9	-77.21
Seabrook	MD	38.97	-76.85
Durant	OK	33.99	-96.37
Killingly Center	CT	41.84	-71.87
Kings Park	NY	40.89	-73.26
Canby	OR	45.26	-122.69
Poplar Bluff	MO	36.76	-90.39
Moraga	CA	37.83	-122.13
Redland	MD	39.15	-77.14
Massapequa Park	NY	40.68	-73.46
Kuna	ID	43.49	-116.42
Foley	AL	30.41	-87.68
Ruskin	FL	27.72	-82.43
Hermiston	OR	45.84	-119.29
Nederland	TX	29.97	-93.99
Greenfield	CA	36.32	-121.24
Ashwaubenon	WI	44.48	-88.07
Live Oak	CA	36.98	-121.98
Bristol	VA	36.6	-82.19
Okolona	KY	38.14	-85.69
Bayside	CA	40.84	-124.06
Wyckoff	NJ	41.01	-74.17
Woodmere	NY	40.63	-73.71
Huntington	IN	40.88	-85.5
Imperial	CA	32.85	-115.57
Wayne	MI	42.28	-83.39
White Settlement	TX	32.76	-97.46
Eloy	AZ	32.76	-111.55
Beckley	WV	37.78	-81.19
Broad Ripple	IN	39.87	-86.14
El Segundo	CA	33.92	-118.42
Holden	MA	42.35	-71.86
Avenel	NJ	40.58	-74.29
East Setauket	NY	40.94	-73.11
Goodlettsville	TN	36.32	-86.71
Fayetteville	GA	33.45	-84.45
Colchester	VT	44.54	-73.15
Altoona	IA	41.64	-93.46
Terrell	TX	32.74	-96.28
Artesia	CA	33.87	-118.08
South Ogden	UT	41.19	-111.97
La Vista	NE	41.18	-96.03
Hanover	MA	42.11	-70.81
Tanque Verde	AZ	32.25	-110.74
Glenvar Heights	FL	25.71	-80.33
Pendleton	OR	45.67	-118.79
Centerville	UT	40.92	-111.87
Sayville	NY	40.74	-73.08
Clarksdale	MS	34.2	-90.57
Fairview Heights	IL	38.59	-89.99
Norwalk	OH	41.24	-82.62
San Carlos Park	FL	26.47	-81.8
Concord	MA	42.46	-71.35
Springfield	TN	36.51	-86.88
New Milford	NJ	40.94	-74.02
North Attleborough Center	MA	41.97	-71.32
Country Club Hills	IL	41.57	-87.72
Lemont	IL	41.67	-88
Sartell	MN	45.62	-94.21
Dyersburg	TN	36.03	-89.39
Defiance	OH	41.28	-84.36
Beltsville	MD	39.03	-76.91
Centralia	WA	46.72	-122.95
Chalmette	LA	29.94	-89.97
Shorewood	IL	41.52	-88.2
Ferndale	MD	39.18	-76.64
Mount Vernon	OH	40.39	-82.49
Westchester	IL	41.85	-87.88
Bluffton	SC	32.24	-80.86
Tifton	GA	31.45	-83.51
Auburn	MA	42.19	-71.84
Nipomo	CA	35.04	-120.48
Laurel	VA	37.64	-77.51
Taylor	TX	30.57	-97.41
North Decatur	GA	33.79	-84.31
Morganton	NC	35.75	-81.68
Danville	KY	37.65	-84.77
Barrington	RI	41.74	-71.31
Washington	IL	40.7	-89.41
Phoenixville	PA	40.13	-75.51
Mercedes	TX	26.15	-97.91
Center Point	AL	33.65	-86.68
Lemay	MO	38.53	-90.28
Wolcott	CT	41.6	-72.99
Norcross	GA	33.94	-84.21
Troutdale	OR	45.54	-122.39
Oak Grove	OR	45.42	-122.64
North Valley Stream	NY	40.69	-73.7
Easton	MD	38.77	-76.08
Easthampton	MA	42.27	-72.67
Bothell West	WA	47.81	-122.24
Tahlequah	OK	35.92	-94.97
Hazel Park	MI	42.46	-83.1
Douglas	AZ	31.34	-109.55
Opelousas	LA	30.53	-92.08
Grafton	MA	42.21	-71.69
Sandalfoot Cove	FL	26.34	-80.19
Brenham	TX	30.17	-96.4
Opa-locka	FL	25.9	-80.25
Beaver Dam	WI	43.46	-88.84
Coalinga	CA	36.14	-120.36
Seymour	CT	41.4	-73.08
Jenison	MI	42.91	-85.79
Cohoes	NY	42.77	-73.7
Swansea	MA	41.75	-71.19
Donna	TX	26.17	-98.05
Vienna	VA	38.9	-77.27
Pinewood	FL	25.87	-80.22
Lansdale	PA	40.24	-75.28
Sevierville	TN	35.87	-83.56
Chickasha	OK	35.05	-97.94
Kingsland	GA	30.8	-81.69
Uvalde	TX	29.21	-99.79
Hillcrest Heights	MD	38.83	-76.96
Stuart	FL	27.2	-80.25
Fairhaven	MA	41.64	-70.9
Avon	IN	39.76	-86.4
Zachary	LA	30.65	-91.16
Red Wing	MN	44.56	-92.53
Sikeston	MO	36.88	-89.59
Bethpage	NY	40.74	-73.48
Concord	MO	38.52	-90.36
Flowing Wells	AZ	32.29	-111.01
Bridgeview	IL	41.75	-87.8
Fairview Park	OH	41.44	-81.86
Laguna Woods	CA	33.61	-117.73
Anacortes	WA	48.51	-122.61
Mount Clemens	MI	42.6	-82.88
Cañon City	CO	38.44	-105.24
Saint Michael	MN	45.21	-93.66
South River	NJ	40.45	-74.39
Fort Thomas	KY	39.08	-84.45
Sunset	FL	25.71	-80.35
Prospect Heights	IL	42.1	-87.94
Griffith	IN	41.53	-87.42
Estelle	LA	29.85	-90.11
Schofield Barracks	HI	21.5	-158.07
Bon Air	VA	37.52	-77.56
Oconomowoc	WI	43.11	-88.5
Hough	OH	41.51	-81.64
Vero Beach	FL	27.64	-80.4
Sunnyside	WA	46.32	-120.01
Lebanon	OR	44.54	-122.91
Bayshore Gardens	FL	27.43	-82.59
Streetsboro	OH	41.24	-81.35
Calhoun	GA	34.5	-84.95
Morton	IL	40.61	-89.46
Menomonie	WI	44.88	-91.92
Truckee	CA	39.33	-120.18
Fremont	OH	41.35	-83.12
Buckhall	VA	38.73	-77.43
Gainesville	TX	33.63	-97.13
Aberdeen	WA	46.98	-123.82
Baychester	NY	40.87	-73.84
Hopatcong Hills	NJ	40.94	-74.67
Waterville	ME	44.55	-69.63
Oroville	CA	39.51	-121.56
Roosevelt	NY	40.68	-73.59
Laconia	NH	43.53	-71.47
Bellmore	NY	40.67	-73.53
Hibbing	MN	47.43	-92.94
Sudley	VA	38.79	-77.5
Dublin	GA	32.54	-82.9
Coos Bay	OR	43.37	-124.22
Hope Mills	NC	34.97	-78.95
Cimarron Hills	CO	38.86	-104.7
Katy	TX	29.79	-95.82
Brunswick	GA	31.15	-81.49
Clarksburg	WV	39.28	-80.34
Jollyville	TX	30.44	-97.78
Highland Village	TX	33.09	-97.05
Ocean Acres	NJ	39.74	-74.28
Wolf Trap	VA	38.94	-77.29
Madison	NJ	40.76	-74.42
Portland	TX	27.88	-97.32
Midway	FL	30.41	-87.01
Sulphur Springs	TX	33.14	-95.6
Maryland City	MD	39.09	-76.82
Siloam Springs	AR	36.19	-94.54
Ham Lake	MN	45.25	-93.25
West Columbia	SC	33.99	-81.07
Frankfort	IN	40.28	-86.51
Mount Pleasant	TX	33.16	-94.97
Dyer	IN	41.49	-87.52
Rye	NY	40.98	-73.68
Fort Hunt	VA	38.73	-77.06
Americus	GA	32.07	-84.23
Hermitage	PA	41.23	-80.45
Buffalo	MN	45.17	-93.87
Crawfordsville	IN	40.04	-86.87
Lake Mary	FL	28.76	-81.32
Republic	MO	37.12	-93.48
Albemarle	NC	35.35	-80.2
Cherry Hill	VA	38.57	-77.27
Country Walk	FL	25.63	-80.43
Riverdale	GA	33.57	-84.41
Abington	MA	42.1	-70.95
Floral Park	NY	40.72	-73.7
Prosper	TX	33.24	-96.8
Walnut Park	CA	33.97	-118.23
Pecan Grove	TX	29.63	-95.73
Overland	MO	38.7	-90.36
Grandville	MI	42.91	-85.76
Four Corners	OR	44.93	-122.98
Sunland Park	NM	31.8	-106.58
North Liberty	IA	41.75	-91.6
Burlington	KY	39.03	-84.72
Parole	MD	38.98	-76.53
Vincent	CA	34.5	-118.12
Southchase	FL	28.39	-81.38
Ukiah	CA	39.15	-123.21
La Marque	TX	29.37	-94.97
North Arlington	NJ	40.79	-74.13
La Palma	CA	33.85	-118.05
Seagoville	TX	32.64	-96.54
Lebanon	IN	40.05	-86.47
Clayton	MO	38.64	-90.32
Pearl River	NY	41.06	-74.02
Conyers	GA	33.67	-84.02
Myrtle Grove	FL	30.42	-87.31
Aldine	TX	29.93	-95.38
Narragansett	RI	41.45	-71.45
Kaukauna	WI	44.28	-88.27
Port Washington	NY	40.83	-73.7
New Port Richey	FL	28.24	-82.72
Aurora	OH	41.32	-81.35
Adams Morgan	DC	38.92	-77.04
Rutland	VT	43.61	-72.97
Asbury Park	NJ	40.22	-74.01
Lutherville-Timonium	MD	39.44	-76.61
Ashland	MA	42.26	-71.46
Hybla Valley	VA	38.75	-77.08
Longmeadow	MA	42.05	-72.58
Elkton	MD	39.61	-75.83
Grosse Pointe Woods	MI	42.44	-82.91
Alton	TX	26.29	-98.31
Pinehurst	NC	35.2	-79.47
Groves	TX	29.95	-93.92
West University Place	TX	29.72	-95.43
Wilkinsburg	PA	40.44	-79.88
Manassas Park	VA	38.78	-77.47
Willow Grove	PA	40.14	-75.12
Gatesville	TX	31.44	-97.74
Avon Center	OH	41.46	-82.02
La Grange	IL	41.81	-87.87
Great Bend	KS	38.36	-98.76
Shively	KY	38.2	-85.82
Highland Springs	VA	37.55	-77.33
Hueytown	AL	33.45	-87
Talladega	AL	33.44	-86.11
New Haven	IN	41.07	-85.01
Mill Creek East	WA	47.84	-122.19
Middleburg Heights	OH	41.36	-81.81
Pacific Grove	CA	36.62	-121.92
Mitchell	SD	43.71	-98.03
Humble	TX	30	-95.26
Greenwood Village	CO	39.62	-104.95
Bryn Mawr-Skyway	WA	47.49	-122.24
Bradley	IL	41.14	-87.86
McKinley Park	IL	41.83	-87.67
Elkridge	MD	39.21	-76.71
Aberdeen	MD	39.51	-76.16
North Myrtle Beach	SC	33.82	-78.68
Williamstown	NJ	39.69	-75
Long Beach	MS	30.35	-89.15
Otsego	MN	45.27	-93.59
Boulder City	NV	35.98	-114.83
Fillmore	CA	34.4	-118.92
Lake Wales	FL	27.9	-81.59
Alum Rock	CA	37.37	-121.83
Addison	TX	32.96	-96.83
East Riverdale	MD	38.96	-76.92
Laurinburg	NC	34.77	-79.46
Hernando	MS	34.82	-89.99
Hurricane	UT	37.18	-113.29
Plainfield	CT	41.68	-71.92
Hanover	PA	39.8	-76.98
Lithia Springs	GA	33.79	-84.66
Farmingville	NY	40.83	-73.03
Mastic	NY	40.8	-72.84
Setauket-East Setauket	NY	40.93	-73.1
Harrison	NJ	40.75	-74.16
Martha Lake	WA	47.85	-122.24
Port Richmond	NY	40.63	-74.14
Indianola	IA	41.36	-93.56
Perry	GA	32.46	-83.73
Jasper	IN	38.39	-86.93
Winder	GA	33.99	-83.72
Clive	IA	41.6	-93.72
Clemson	SC	34.68	-82.84
Greenwood	MS	33.52	-90.18
Tavares	FL	28.8	-81.73
Great Falls	VA	39	-77.29
Jamestown	ND	46.91	-98.71
Terrace Heights	NY	40.72	-73.77
Emerson Hill	NY	40.61	-74.1
Avocado Heights	CA	34.04	-117.99
Eden	NC	36.49	-79.77
Bay Village	OH	41.48	-81.92
Lake Butler	FL	28.5	-81.54
Makakilo City	HI	21.35	-158.09
Westbury	NY	40.76	-73.59
Bostonia	CA	32.81	-116.94
Iona	FL	26.52	-81.96
Dickson	TN	36.08	-87.39
Newport	KY	39.09	-84.5
Cullman	AL	34.17	-86.84
Live Oak	TX	29.57	-98.34
Roanoke Rapids	NC	36.46	-77.65
Payson	AZ	34.23	-111.33
Storrs	CT	41.81	-72.25
The Dalles	OR	45.59	-121.18
Los Lunas	NM	34.81	-106.73
Dixon	IL	41.84	-89.48
Bellevue	WI	44.44	-87.92
Sunland	CA	34.27	-118.3
Millbrook	AL	32.48	-86.36
Brownsville	FL	25.82	-80.24
Wailuku	HI	20.89	-156.51
Warren Township	NJ	40.61	-74.52
Seaford	NY	40.67	-73.49
Washougal	WA	45.58	-122.35
Dallas	OR	44.92	-123.32
Graniteville	NY	40.62	-74.15
Henderson	NC	36.33	-78.4
Stallings	NC	35.09	-80.69
River Falls	WI	44.86	-92.62
Berkley	MI	42.5	-83.18
Damascus	MD	39.29	-77.2
Shelbyville	KY	38.21	-85.22
Susanville	CA	40.42	-120.65
Pataskala	OH	40	-82.67
Traverse City	MI	44.76	-85.62
South Yuba City	CA	39.12	-121.64
Merrifield	VA	38.87	-77.23
Ledyard	CT	41.44	-72.01
Fords	NJ	40.53	-74.32
New Territory	TX	29.59	-95.68
Kapolei	HI	21.34	-158.06
Clearlake	CA	38.96	-122.63
McKinleyville	CA	40.95	-124.1
Brunswick	ME	43.91	-69.97
Highview	KY	38.14	-85.62
Kenmore	NY	42.97	-78.87
Belvedere Park	GA	33.75	-84.27
Ripon	CA	37.74	-121.12
Rossville	MD	39.34	-76.48
Depew	NY	42.9	-78.69
Seven Oaks	SC	34.05	-81.15
Wilmington Island	GA	32	-80.97
Parlier	CA	36.61	-119.53
Gates-North Gates	NY	43.17	-77.7
East Rancho Dominguez	CA	33.9	-118.2
Natchez	MS	31.56	-91.4
Cloverly	MD	39.11	-77
Newton	IA	41.7	-93.05
Lamont	CA	35.26	-118.91
East Brainerd	TN	35	-85.15
Vandalia	OH	39.89	-84.2
Rio Linda	CA	38.69	-121.45
East Longmeadow	MA	42.06	-72.51
Ramsey	NJ	41.06	-74.14
West Park	FL	25.98	-80.2
Greeneville	TN	36.16	-82.83
Mount Vernon	IL	38.32	-88.9
Adelphi	MD	39	-76.97
Front Royal	VA	38.92	-78.19
Weston	WI	44.89	-89.55
Spanish Springs	NV	39.65	-119.71
Fort Leonard Wood	MO	37.71	-92.16
Sterling	IL	41.79	-89.7
Williamsburg	VA	37.27	-76.71
Somerton	AZ	32.6	-114.71
Three Lakes	FL	25.64	-80.4
Auburndale	FL	28.07	-81.79
Gloversville	NY	43.05	-74.34
Hereford	TX	34.82	-102.4
Eggertsville	NY	42.96	-78.8
Batavia	NY	43	-78.19
Dumas	TX	35.87	-101.97
Bull Run	VA	38.78	-77.52
Ammon	ID	43.47	-111.97
‘Ewa Beach	HI	21.32	-158.01
New River	AZ	33.92	-112.14
Kilgore	TX	32.39	-94.88
Fullerton	PA	40.63	-75.47
Knik-Fairview	AK	61.51	-149.6
Hudson	MA	42.39	-71.57
Tonawanda	NY	43.02	-78.88
Villa Rica	GA	33.73	-84.92
North New Hyde Park	NY	40.74	-73.69
Johnstown	CO	40.34	-104.91
Tolland	CT	41.87	-72.37
Canyon	TX	34.98	-101.92
Jacksonville	TX	31.96	-95.27
Berea	KY	37.57	-84.3
Tenafly	NJ	40.93	-73.96
Marco	FL	25.97	-81.73
East San Gabriel	CA	34.09	-118.09
Jackson	MO	37.38	-89.67
Corinth	MS	34.93	-88.52
Coto De Caza	CA	33.6	-117.59
Englewood	FL	26.96	-82.35
Crowley	TX	32.58	-97.36
Saint John	IN	41.45	-87.47
Midlothian	IL	41.63	-87.72
Welby	CO	39.84	-104.96
Horsham	PA	40.18	-75.13
Mastic Beach	NY	40.77	-72.85
Mashpee	MA	41.65	-70.48
Powder Springs	GA	33.86	-84.68
Masonboro	NC	34.18	-77.85
Jennings	MO	38.72	-90.26
Head of Westport	MA	41.62	-71.06
Scottsbluff	NE	41.87	-103.67
Sierra Vista Southeast	AZ	31.45	-110.22
East Highland Park	VA	37.58	-77.41
Glen Allen	VA	37.67	-77.51
Johnson City	NY	42.12	-75.96
Douglaston	NY	40.77	-73.75
Mineral Wells	TX	32.81	-98.11
Cherryland	CA	37.68	-122.1
Scottsboro	AL	34.67	-86.03
Ozark	AL	31.46	-85.64
Alexander City	AL	32.94	-85.95
Lady Lake	FL	28.92	-81.92
Niceville	FL	30.52	-86.48
West Norriton	PA	40.13	-75.38
Owosso	MI	43	-84.18
Blytheville	AR	35.93	-89.92
Ellington	CT	41.9	-72.47
Whitewater	WI	42.83	-88.73
Lebanon	MO	37.68	-92.66
North Fair Oaks	CA	37.47	-122.2
Hollins	VA	37.34	-79.94
Forrest City	AR	35.01	-90.79
Parkway	CA	38.5	-121.46
Colesville	MD	39.08	-77
Graham	NC	36.07	-79.4
Cinnaminson	NJ	40	-74.99
Fraser	MI	42.54	-82.95
Chaparral	NM	32.02	-106.39
Clark	NJ	40.64	-74.31
Norridge	IL	41.96	-87.83
Hammonton	NJ	39.64	-74.8
Zephyrhills	FL	28.23	-82.18
College Park	GA	33.65	-84.45
Groveton	VA	38.77	-77.08
Bemidji	MN	47.47	-94.88
Hawaiian Gardens	CA	33.83	-118.07
Bloomsburg	PA	41	-76.45
Thibodaux	LA	29.8	-90.82
Valle Vista	CA	33.75	-116.89
Alamo	CA	37.85	-122.03
Druid Hills	GA	33.78	-84.34
Yankton	SD	42.87	-97.4
Beech Grove	IN	39.72	-86.09
Cedar Mill	OR	45.52	-122.81
Lake Saint Louis	MO	38.8	-90.79
Northview	MI	43.05	-85.6
Harrisburg	NC	35.32	-80.66
Warrington	FL	30.38	-87.27
Royal Kunia	HI	21.39	-158.03
Deming	NM	32.27	-107.76
Greece	NY	43.21	-77.69
Springdale	NJ	39.9	-74.97
Phillipsburg	NJ	40.69	-75.19
Hopatcong	NJ	40.93	-74.66
Worthington	OH	40.09	-83.02
Whitman	MA	42.08	-70.94
Greensburg	PA	40.3	-79.54
Hartselle	AL	34.44	-86.94
Miami Springs	FL	25.82	-80.29
South Farmingdale	NY	40.72	-73.44
East Islip	NY	40.73	-73.19
Kerman	CA	36.72	-120.06
Warsaw	IN	41.24	-85.85
Glasgow	KY	37	-85.91
North Branford	CT	41.33	-72.77
Fairview	NJ	40.81	-74
Springfield	NJ	40.7	-74.32
Chubbuck	ID	42.92	-112.47
Scott Lake	FL	25.94	-80.23
Robbinsdale	MN	45.03	-93.34
Franklin Park	PA	40.58	-80.09
Lindenhurst	IL	42.41	-88.03
Bridgetown	OH	39.15	-84.64
Callaway	FL	30.15	-85.57
Rio Grande City	TX	26.38	-98.82
Pineville	LA	31.32	-92.43
Cahokia	IL	38.57	-90.19
Sarasota Springs	FL	27.31	-82.48
Mill Valley	CA	37.91	-122.54
Hugo	MN	45.16	-92.99
Moultrie	GA	31.18	-83.79
Brooklyn Park	MD	39.23	-76.62
Chicago Ridge	IL	41.7	-87.78
Cutlerville	MI	42.84	-85.66
Morris	IL	41.36	-88.42
Hartford	WI	43.32	-88.38
Brookside	DE	39.67	-75.73
Highland Park	NJ	40.5	-74.42
Beacon	NY	41.5	-73.97
Woodcrest	CA	33.88	-117.36
Greendale	WI	42.94	-88
Antioch	IL	42.48	-88.1
Hunters Creek	FL	28.36	-81.42
Carthage	MO	37.18	-94.31
Manorville	NY	40.87	-72.81
Phelan	CA	34.43	-117.57
Glasgow	DE	39.6	-75.75
Berea	SC	34.89	-82.46
Glens Falls	NY	43.31	-73.64
Los Osos	CA	35.31	-120.83
New Franklin	OH	40.94	-81.54
Hershey	PA	40.29	-76.65
Knightdale	NC	35.79	-78.48
Hewitt	TX	31.46	-97.2
Alpine	CA	32.84	-116.77
Gibsonton	FL	27.85	-82.38
Gantt	SC	34.8	-82.42
Lakeway	TX	30.36	-97.98
Moorestown-Lenola	NJ	39.97	-74.96
Murraysville	NC	34.3	-77.85
Canton	IL	40.56	-90.04
Bradley Gardens	NJ	40.56	-74.65
Elk Plain	WA	47.05	-122.4
Camano	WA	48.17	-122.53
Berkeley Heights	NJ	40.68	-74.44
Mount Holly	NC	35.3	-81.02
Cherry Hill Mall	NJ	39.94	-75.01
Oldsmar	FL	28.03	-82.67
Fort Payne	AL	34.44	-85.72
Wykagyl	NY	40.94	-73.8
Jefferson Valley-Yorktown	NY	41.32	-73.8
Five Forks	SC	34.8	-82.23
Hayden	ID	47.77	-116.79
Red Bluff	CA	40.18	-122.24
New Fairfield	CT	41.47	-73.49
Forest Park	IL	41.88	-87.81
Hickory Hills	IL	41.73	-87.83
Hyannis	MA	41.65	-70.28
Arverne	NY	40.59	-73.8
Hazel Crest	IL	41.57	-87.69
Whitefish Bay	WI	43.11	-87.9
Weehawken	NJ	40.77	-74.02
Sterling	CO	40.63	-103.21
North Reading	MA	42.58	-71.08
Indiana	PA	40.62	-79.15
Fish Hawk	FL	27.85	-82.21
Longwood	FL	28.7	-81.34
Jasper	AL	33.83	-87.28
Reidsville	NC	36.35	-79.66
Dentsville	SC	34.06	-80.96
Northbridge	MA	42.15	-71.65
New Cassel	NY	40.76	-73.57
Rosedale	CA	35.38	-119.15
Apollo Beach	FL	27.77	-82.41
Waycross	GA	31.21	-82.36
Washington	MO	38.56	-91.01
Chippewa Falls	WI	44.94	-91.39
Westwood	MA	42.21	-71.22
Mount Washington	KY	38.05	-85.55
East Bridgewater	MA	42.03	-70.96
Washington Court House	OH	39.54	-83.44
Rocky Point	NY	40.95	-72.93
Hālawa	HI	21.38	-157.92
Holliston	MA	42.2	-71.42
Pierre	SD	44.37	-100.35
Collingswood	NJ	39.92	-75.07
Horizon West	FL	28.43	-81.62
Elfers	FL	28.22	-82.72
McFarland	CA	35.68	-119.23
Beach Park	IL	42.42	-87.86
Sun Lakes	AZ	33.21	-111.88
Fairburn	GA	33.57	-84.58
Lincoln	IL	40.15	-89.36
Seekonk	MA	41.81	-71.34
Upper Grand Lagoon	FL	30.16	-85.74
Willowick	OH	41.63	-81.47
Orange	CT	41.28	-73.03
Auburn	CA	38.9	-121.08
South Venice	FL	27.05	-82.42
Maumee	OH	41.56	-83.65
Middlesex	NJ	40.57	-74.49
Allouez	WI	44.48	-88.02
Paradise Valley	AZ	33.53	-111.94
Moberly	MO	39.42	-92.44
Wood Dale	IL	41.96	-87.98
Covington	GA	33.6	-83.86
Saint Simon Mills	GA	31.17	-81.41
Levelland	TX	33.59	-102.38
Hutchinson	MN	44.89	-94.37
Saraland	AL	30.82	-88.07
King City	CA	36.21	-121.13
Livingston	CA	37.39	-120.72
Marietta	OH	39.42	-81.45
Falls Church	VA	38.88	-77.17
Metuchen	NJ	40.54	-74.36
Olean	NY	42.08	-78.43
Oneonta	NY	42.45	-75.06
Ephrata	PA	40.18	-76.18
Circleville	OH	39.6	-82.95
Forest City	FL	28.67	-81.44
Harper Woods	MI	42.43	-82.92
Princeton Meadows	NJ	40.33	-74.56
Whitehall	PA	40.36	-79.99
Sault Ste. Marie	MI	46.5	-84.35
Andrews	TX	32.32	-102.55
Hendersonville	NC	35.32	-82.46
Wauconda	IL	42.26	-88.14
Fort Carson	CO	38.74	-104.79
Oak Park	CA	34.18	-118.76
Stanford	CA	37.42	-122.17
Pottsville	PA	40.69	-76.2
Homosassa Springs	FL	28.8	-82.58
Ladson	SC	32.99	-80.11
Swampscott	MA	42.47	-70.92
Sharonville	OH	39.27	-84.41
Elizabethton	TN	36.35	-82.21
Clarksburg	MD	39.24	-77.28
McMinnville	TN	35.68	-85.77
Cromwell	CT	41.6	-72.65
Buford	GA	34.12	-84
Wixom	MI	42.52	-83.54
West Richland	WA	46.3	-119.36
Greenlawn	NY	40.87	-73.37
Stony Brook	NY	40.93	-73.14
Mountain Home	ID	43.13	-115.69
Waimalu	HI	21.4	-157.94
Carpinteria	CA	34.4	-119.52
Salida	CA	37.71	-121.08
Sienna Plantation	TX	29.49	-95.51
Seabrook	TX	29.56	-95.03
Gardendale	AL	33.66	-86.81
Hidalgo	TX	26.1	-98.26
Muscle Shoals	AL	34.74	-87.67
Buda	TX	30.09	-97.84
Mebane	NC	36.1	-79.27
Baker	LA	30.59	-91.17
Richton Park	IL	41.48	-87.7
Lyndhurst	OH	41.52	-81.49
Athens	TN	35.44	-84.59
Fort Campbell North	KY	36.65	-87.46
East Greenwich	RI	41.66	-71.46
Palos Verdes Estates	CA	33.8	-118.39
Canton	MS	32.61	-90.04
Boerne	TX	29.79	-98.73
Roselle Park	NJ	40.66	-74.26
Fort Mill	SC	35.01	-80.95
East Wenatchee	WA	47.42	-120.29
Olivehurst	CA	39.1	-121.55
Moss Point	MS	30.41	-88.53
Bexley	OH	39.97	-82.94
Marshall	MN	44.45	-95.79
Pell City	AL	33.59	-86.29
Martinsville	VA	36.69	-79.87
Monroe	GA	33.79	-83.71
Copley	OH	41.1	-81.64
Cayce	SC	33.97	-81.07
West Freehold	NJ	40.24	-74.3
Miami	OK	36.87	-94.88
La Grange Park	IL	41.83	-87.86
Port Orchard	WA	47.54	-122.64
Millbury	MA	42.19	-71.76
Hampton Bays	NY	40.87	-72.52
Grover Beach	CA	35.12	-120.62
Bergen Beach	NY	40.62	-73.91
Lebanon	NH	43.64	-72.25
Lewisville	NC	36.1	-80.42
Jericho	NY	40.79	-73.54
Hudson	WI	44.97	-92.76
Sharon	PA	41.23	-80.49
Verona	NJ	40.83	-74.24
Swansea	IL	38.53	-89.99
Warrensville Heights	OH	41.44	-81.54
Southern Pines	NC	35.17	-79.39
Riverdale	IL	41.63	-87.63
Palmetto Estates	FL	25.62	-80.36
Henderson	TX	32.15	-94.8
Glenmont	MD	39.06	-77.05
North Mankato	MN	44.17	-94.03
Hockessin	DE	39.79	-75.7
Destin	FL	30.39	-86.5
Mount Dora	FL	28.8	-81.64
Lynden	WA	48.95	-122.45
Havre de Grace	MD	39.55	-76.09
Washington	PA	40.17	-80.25
Waxhaw	NC	34.92	-80.74
White Center	WA	47.52	-122.35
River Ridge	LA	29.96	-90.22
Olympia Heights	FL	25.73	-80.36
Village of Campton Hills	IL	41.94	-88.4
Conway	FL	28.5	-81.33
Glenn Dale	MD	38.99	-76.82
San Marino	CA	34.12	-118.11
Englewood	OH	39.88	-84.3
Orangeburg	SC	33.49	-80.86
Solana Beach	CA	32.99	-117.27
Timberwood Park	TX	29.71	-98.48
Lockhart	TX	29.88	-97.67
Brecksville	OH	41.32	-81.63
Chesterton	IN	41.61	-87.06
Sauk Rapids	MN	45.59	-94.17
South Park Township	PA	40.3	-79.99
Oatfield	OR	45.41	-122.6
Hālawa Heights	HI	21.38	-157.91
Monroe	OH	39.44	-84.36
Kings Park West	VA	38.81	-77.3
Nesconset	NY	40.85	-73.15
Las Vegas	NM	35.59	-105.22
Grain Valley	MO	39.02	-94.2
Dunmore	PA	41.42	-75.63
Brainerd	MN	46.36	-94.2
Western Springs	IL	41.81	-87.9
Discovery Bay	CA	37.91	-121.6
Bedford	IN	38.86	-86.49
Bellair-Meadowbrook Terrace	FL	30.18	-81.74
Saint James	NY	40.88	-73.16
Ridge	NY	40.89	-72.9
New Ulm	MN	44.31	-94.46
South Sioux City	NE	42.47	-96.41
Warrenville	IL	41.82	-88.17
Huron	SD	44.36	-98.21
Shorewood	WI	43.09	-87.89
Waunakee	WI	43.19	-89.46
Beaufort	SC	32.43	-80.67
Avenal	CA	36	-120.13
Monticello	MN	45.31	-93.79
Riverhead	NY	40.92	-72.66
West Carrollton City	OH	39.67	-84.25
Franklin Park	NJ	40.44	-74.54
Piney Green	NC	34.72	-77.32
Butler	PA	40.86	-79.9
Citrus Ridge	FL	28.33	-81.64
Fergus Falls	MN	46.28	-96.08
Beeville	TX	28.4	-97.75
California City	CA	35.13	-117.99
Gonzalez	FL	30.58	-87.29
Vadnais Heights	MN	45.06	-93.07
North Adams	MA	42.7	-73.11
Palmetto	FL	27.52	-82.57
Lake Forest Park	WA	47.76	-122.28
Spring Lake	NC	35.17	-78.97
Mercerville	NJ	40.24	-74.69
Colonial Park	PA	40.3	-76.81
Glenpool	OK	35.96	-96.01
Fruitville	FL	27.33	-82.46
Red Hill	SC	34	-79.26
Lindsay	CA	36.2	-119.09
Calera	AL	33.1	-86.75
University Heights	OH	41.5	-81.54
Carriere	MS	30.62	-89.65
Atlantic Beach	FL	30.33	-81.4
Streator	IL	41.12	-88.84
Lea Hill	WA	47.33	-122.18
Waianae	HI	21.44	-158.19
Teays Valley	WV	38.45	-81.93
Lone Tree	CO	39.55	-104.89
Brandermill	VA	37.43	-77.65
Soddy-Daisy	TN	35.24	-85.19
Snoqualmie	WA	47.53	-121.83
Fostoria	OH	41.16	-83.42
Oakland	NJ	41.01	-74.26
Short Hills	NJ	40.75	-74.33
Wayland	MA	42.36	-71.36
Raynham	MA	41.95	-71.07
Coatesville	PA	39.98	-75.82
Clayton	OH	39.86	-84.36
McPherson	KS	38.37	-97.66
Crowley	LA	30.21	-92.37
Harrison	AR	36.23	-93.11
Saddle Brook	NJ	40.9	-74.09
Bellefontaine	OH	40.36	-83.76
Black Forest	CO	39.01	-104.7
Ridgefield Park	NJ	40.86	-74.02
Grovetown	GA	33.45	-82.2
Bardstown	KY	37.81	-85.47
Windham	NH	42.8	-71.3
Worthington	MN	43.62	-95.6
Commerce	CA	34	-118.16
La Grande	OR	45.32	-118.09
Saint Marys	PA	41.43	-78.56
Stoughton	WI	42.92	-89.22
Kingsgate	WA	47.73	-122.18
Geneva	NY	42.87	-76.98
Meadville	PA	41.64	-80.15
Lockhart	FL	28.62	-81.44
Harwich	MA	41.69	-70.08
South Charleston	WV	38.37	-81.7
Medway	MA	42.14	-71.4
Marshall	MO	39.12	-93.2
Santa Fe	TX	29.38	-95.11
Newton	NC	35.67	-81.22
North Auburn	CA	38.93	-121.08
Tehachapi	CA	35.13	-118.45
Saint Ann	MO	38.73	-90.38
Thonotosassa	FL	28.06	-82.3
Endicott	NY	42.1	-76.05
Connersville	IN	39.64	-85.14
Arrochar	NY	40.6	-74.07
Ferndale	WA	48.85	-122.59
Middleburg	FL	30.07	-81.86
Rantoul	IL	40.31	-88.16
Greenville	OH	40.1	-84.63
Saint Simons Island	GA	31.15	-81.37
Shadow Hills	CA	34.26	-118.35
Woodward	OK	36.43	-99.39
Rochester	MI	42.68	-83.13
Key Biscayne	FL	25.69	-80.16
Claremont	NH	43.38	-72.35
Superior	CO	39.95	-105.17
Auburn	IN	41.37	-85.06
Saint Augustine	FL	29.89	-81.31
Powell	OH	40.16	-83.08
Justice	IL	41.74	-87.84
Glen Carbon	IL	38.75	-89.98
West Monroe	LA	32.52	-92.15
Malibu	CA	34.03	-118.78
Borger	TX	35.67	-101.4
College	AK	64.86	-147.8
Shiloh	IL	38.56	-89.9
Fort Drum	NY	44.06	-75.76
Grass Valley	CA	39.22	-121.06
Newington	VA	38.74	-77.18
Greenwich	CT	41.03	-73.63
Lakeland North	WA	47.33	-122.28
Kingston	PA	41.26	-75.9
Fulton	MO	38.85	-91.95
El Dorado	KS	37.82	-96.86
Wawarsing	NY	41.76	-74.36
Mounds View	MN	45.1	-93.21
Herrin	IL	37.8	-89.03
Grenada	MS	33.77	-89.81
Dover	OH	40.52	-81.47
Hanover	NJ	40.8	-74.37
Dardenne Prairie	MO	38.77	-90.73
Saint Helens	OR	45.86	-122.81
Forest Hill	TX	32.67	-97.27
Weigelstown	PA	39.98	-76.82
Dallas	GA	33.92	-84.84
Glendale	WI	43.14	-87.94
York Beach	ME	43.17	-70.61
Holiday City-Berkeley	NJ	39.96	-74.28
Hot Springs Village	AR	34.67	-93
Fruita	CO	39.16	-108.73
Kettering	MD	38.88	-76.81
Athens	TX	32.2	-95.86
New Carrollton	MD	38.97	-76.88
Port Neches	TX	29.99	-93.96
Hamilton Square	NJ	40.23	-74.65
Fallsburg	NY	41.73	-74.6
Charlton	MA	42.14	-71.97
Seaside	NY	40.58	-73.83
Bedford	OH	41.39	-81.54
Andover	KS	37.71	-97.14
Finneytown	OH	39.2	-84.52
Elk City	OK	35.41	-99.4
New Kensington	PA	40.57	-79.76
Conneaut	OH	41.95	-80.55
Derby	CT	41.32	-73.09
Boone	IA	42.06	-93.88
Minden	LA	32.62	-93.29
Middle Valley	TN	35.2	-85.18
Markham	IL	41.59	-87.69
Belle Chasse	LA	29.85	-89.99
Riviera Beach	MD	39.17	-76.51
Pelham	NH	42.73	-71.32
Pedley	CA	33.98	-117.48
El Sobrante	CA	37.98	-122.3
Nānākuli	HI	21.39	-158.15
McComb	MS	31.24	-90.45
Sylacauga	AL	33.17	-86.25
Half Moon Bay	CA	37.46	-122.43
Lilburn	GA	33.89	-84.14
Centralia	IL	38.53	-89.13
West Valley	WA	46.59	-120.61
San Anselmo	CA	37.97	-122.56
Artondale	WA	47.3	-122.62
Lincolnwood	IL	42	-87.73
Panama City Beach	FL	30.18	-85.81
Montgomeryville	PA	40.25	-75.24
Joppatowne	MD	39.46	-76.36
Uxbridge	MA	42.08	-71.63
Effingham	IL	39.12	-88.54
Eufaula	AL	31.89	-85.15
Channahon	IL	41.43	-88.23
Moody	AL	33.59	-86.49
Loveland	OH	39.27	-84.26
South Daytona	FL	29.17	-81
Platteville	WI	42.73	-90.48
Gaffney	SC	35.07	-81.65
Kemp Mill	MD	39.04	-77.02
Rogers	MN	45.19	-93.55
Azalea Park	FL	28.54	-81.3
Lakeland	TN	35.23	-89.74
Rendon	TX	32.58	-97.24
Palos Heights	IL	41.67	-87.8
Wickliffe	OH	41.61	-81.45
Verona	WI	42.99	-89.53
Woodhaven	MI	42.14	-83.24
Bonita	CA	32.66	-117.03
Kewanee	IL	41.25	-89.92
Woodland Park	NJ	40.89	-74.19
Bainbridge	GA	30.9	-84.58
Cambridge	MD	38.56	-76.08
Bedford	MA	42.49	-71.28
Windsor Locks	CT	41.93	-72.63
Winnetka	IL	42.11	-87.74
New Providence	NJ	40.7	-74.4
Green River	WY	41.53	-109.47
Grand Terrace	CA	34.03	-117.31
Patchogue	NY	40.77	-73.02
Cedar Grove	NJ	40.85	-74.23
Ardmore	PA	40.01	-75.29
Wilmington	OH	39.45	-83.83
Ringwood	NJ	41.11	-74.25
North Madison	IN	38.77	-85.4
Steamboat Springs	CO	40.48	-106.83
Abbeville	LA	29.97	-92.13
Fort Atkinson	WI	42.93	-88.84
Lake Arrowhead	CA	34.25	-117.19
Irondale	AL	33.54	-86.71
Lumberton	TX	30.27	-94.2
Larkspur	CA	37.93	-122.54
Port Lavaca	TX	28.62	-96.63
Mount Vernon	VA	38.71	-77.1
Brookhaven	MS	31.58	-90.44
Fernway	PA	40.69	-80.13
Beatrice	NE	40.27	-96.75
Ottawa	KS	38.62	-95.27
Wilton Manors	FL	26.16	-80.14
Four Corners	TX	29.67	-95.66
Federal Heights	CO	39.85	-105
Spring Creek	NV	40.73	-115.59
New Baltimore	MI	42.68	-82.74
Forestville	MD	38.85	-76.87
Atco	NJ	39.77	-74.89
Mandeville	LA	30.36	-90.07
Fernandina Beach	FL	30.67	-81.46
Miller Place	NY	40.96	-73
Escanaba	MI	45.75	-87.06
Mountain Home	AR	36.34	-92.39
Lake Los Angeles	CA	34.61	-117.83
Cleveland	MS	33.74	-90.72
Portland	TN	36.58	-86.52
Gulfport	FL	27.75	-82.7
Plover	WI	44.46	-89.54
Cornelius	OR	45.52	-123.06
Broadlands	VA	39.02	-77.52
Northlake	IL	41.92	-87.9
Big Bear City	CA	34.26	-116.85
North Castle	NY	41.14	-73.68
Eatontown	NJ	40.3	-74.05
Coolidge	AZ	32.98	-111.52
Marion	AR	35.21	-90.2
West Plains	MO	36.73	-91.85
Plymouth	CT	41.67	-73.05
Trenton	OH	39.48	-84.46
Overlea	MD	39.36	-76.52
North Merrick	NY	40.69	-73.56
Port Saint John	FL	28.48	-80.79
Green Valley	MD	39.31	-77.3
Okmulgee	OK	35.62	-95.96
South Miami	FL	25.71	-80.29
Hasbrouck Heights	NJ	40.86	-74.08
Jacksonville	AL	33.81	-85.76
Marysville	CA	39.15	-121.59
Clarkston	GA	33.81	-84.24
Kingston	MA	41.99	-70.72
Davidson	NC	35.5	-80.84
Winfield	KS	37.24	-97
Red Bank	NJ	40.35	-74.06
Somerville	NJ	40.57	-74.61
Kings Point	FL	26.45	-80.14
East Hanover	NJ	40.82	-74.36
Tucson Estates	AZ	32.19	-111.09
Haverstraw	NY	41.2	-73.96
Suamico	WI	44.63	-88.04
Timberlake	VA	37.32	-79.26
Riverview	MI	42.17	-83.18
Choctaw	OK	35.5	-97.27
Lake City	FL	30.19	-82.64
Babylon	NY	40.7	-73.33
Travilah	MD	39.07	-77.26
Blue Ash	OH	39.23	-84.38
Hudson	FL	28.36	-82.69
Neosho	MO	36.87	-94.37
Baraboo	WI	43.47	-89.74
Freeport	TX	28.95	-95.36
Stony Point	NY	41.23	-73.99
Richmond	TX	29.58	-95.76
Arkansas City	KS	37.06	-97.04
Amherst	OH	41.4	-82.22
New Kingman-Butler	AZ	35.27	-114.03
Evanston	WY	41.27	-110.96
Speedway	IN	39.8	-86.27
Weatherford	OK	35.53	-98.71
Florida City	FL	25.45	-80.48
Port Royal	SC	32.38	-80.69
Wells Branch	TX	30.45	-97.68
Luling	LA	29.93	-90.37
Mount Sinai	NY	40.95	-73.03
Brown Deer	WI	43.16	-87.96
Salisbury	NY	40.75	-73.56
Dunkirk	NY	42.48	-79.33
Woodmere	LA	29.86	-90.08
Washington	IN	38.66	-87.17
Cloquet	MN	46.72	-92.46
Festus	MO	38.22	-90.4
Chelsea	AL	33.34	-86.63
Poquoson	VA	37.12	-76.35
Irmo	SC	34.09	-81.18
Lake Station	IN	41.58	-87.24
Glenn Heights	TX	32.55	-96.86
Madison	IN	38.74	-85.38
Goldenrod	FL	28.61	-81.29
Norton	OH	41.03	-81.64
Artesia	NM	32.84	-104.4
Edgewater	NJ	40.83	-73.98
Fairfax Station	VA	38.8	-77.33
Stafford	CT	41.98	-72.29
Centerton	AR	36.36	-94.29
Smithfield	NC	35.51	-78.34
Red Oak	TX	32.52	-96.8
Los Alamos	NM	35.89	-106.31
North Palm Beach	FL	26.82	-80.08
Clawson	MI	42.53	-83.15
Salem	OH	40.9	-80.86
Cedar Lake	IN	41.36	-87.44
Fortuna	CA	40.6	-124.16
Glen Rock	NJ	40.96	-74.13
Firestone	CO	40.11	-104.94
Portales	NM	34.19	-103.33
Gladstone	OR	45.38	-122.59
La Homa	TX	26.25	-98.36
Martinsville	NJ	40.6	-74.56
Kailua-Kona	HI	19.64	-156
Waconia	MN	44.85	-93.79
Shepherdsville	KY	37.99	-85.72
Crestwood	MO	38.56	-90.38
Youngsville	LA	30.1	-91.99
North Wantagh	NY	40.69	-73.51
Freehold	NJ	40.26	-74.27
Monfort Heights	OH	39.19	-84.6
Scotts Valley	CA	37.05	-122.01
Holly Hill	FL	29.24	-81.04
Leeds	AL	33.55	-86.54
Richmond Hill	GA	31.94	-81.3
Bogalusa	LA	30.79	-89.85
Bennsville	MD	38.61	-77.01
Dranesville	VA	39	-77.35
Guymon	OK	36.68	-101.48
West Haven	UT	41.2	-112.05
Bucyrus	OH	40.81	-82.98
Kelso	WA	46.15	-122.91
Pennsville	NJ	39.65	-75.52
Maryville	MO	40.35	-94.87
Clayton	CA	37.94	-121.94
California	MD	38.3	-76.51
Lakeside	VA	37.61	-77.48
Terryville	NY	40.91	-73.07
Wanaque	NJ	41.04	-74.29
Cypress Lake	FL	26.54	-81.9
Alexandria	MN	45.89	-95.38
Westwood Lake	FL	25.73	-80.37
Morgan City	LA	29.7	-91.21
Florham Park	NJ	40.79	-74.39
Kingsburg	CA	36.51	-119.55
Georgetown	GA	31.98	-81.23
Greensburg	IN	39.34	-85.48
Cottonwood	AZ	34.74	-112.01
Schiller Park	IL	41.96	-87.87
Lovington	NM	32.94	-103.35
Sugarland Run	VA	39.04	-77.38
Pontiac	IL	40.88	-88.63
Bridgeton	MO	38.77	-90.41
Franklin	OH	39.56	-84.3
Woodinville	WA	47.75	-122.16
Red Bank	TN	35.11	-85.29
Newport East	RI	41.52	-71.29
Snyder	TX	32.72	-100.92
Lansing	KS	39.25	-94.9
Beachwood	OH	41.46	-81.51
Lower Burrell	PA	40.55	-79.76
Trophy Club	TX	33	-97.18
Somersworth	NH	43.26	-70.87
Healdsburg	CA	38.61	-122.87
Blackfoot	ID	43.19	-112.34
South Lyon	MI	42.46	-83.65
Douglas	GA	31.51	-82.85
Carver	MA	41.88	-70.76
Wallington	NJ	40.85	-74.11
Ocean Pines	MD	38.4	-75.16
Jensen Beach	FL	27.25	-80.23
Lahaina	HI	20.87	-156.68
Foothill Ranch	CA	33.69	-117.66
Emeryville	CA	37.83	-122.29
Azle	TX	32.9	-97.55
East Bethel	MN	45.32	-93.2
Martinsville	IN	39.43	-86.43
Seven Hills	OH	41.4	-81.68
Macedonia	OH	41.31	-81.51
Weston	MA	42.37	-71.3
Waipio	HI	21.42	-158
Magnolia	AR	33.27	-93.24
River Edge	NJ	40.93	-74.04
Oquirrh	UT	40.63	-112.03
Guttenberg	NJ	40.79	-74
Mexico	MO	39.17	-91.88
North Lindenhurst	NY	40.71	-73.38
Wyandanch	NY	40.75	-73.36
Goshen	OH	39.23	-84.16
Lexington Park	MD	38.27	-76.45
Arlington	TN	35.3	-89.66
Ravenna	OH	41.16	-81.24
Enumclaw	WA	47.2	-121.99
Oskaloosa	IA	41.3	-92.64
Verde Village	AZ	34.71	-112.01
El Campo	TX	29.2	-96.27
Lynnfield	MA	42.54	-71.05
Cocoa Beach	FL	28.32	-80.61
Elizabethtown	PA	40.15	-76.6
Mack	OH	39.16	-84.65
Robstown	TX	27.79	-97.67
Port Washington	WI	43.39	-87.88
Lakeland South	WA	47.28	-122.28
Home Gardens	CA	33.88	-117.52
Villas	FL	26.55	-81.87
Upper Montclair	NJ	40.85	-74.2
Signal Hill	CA	33.8	-118.17
Sun Village	CA	34.56	-117.96
Archdale	NC	35.91	-79.97
Tarrytown	NY	41.08	-73.86
Moss Bluff	LA	30.3	-93.19
Mountain Park	GA	33.84	-84.13
Fulton	NY	43.32	-76.42
Garden City	ID	43.62	-116.24
Urbana	OH	40.11	-83.75
Valley Falls	RI	41.91	-71.39
North Bellport	NY	40.77	-72.94
Troy	MO	38.98	-90.98
Lakeland Village	CA	33.64	-117.34
Tomball	TX	30.1	-95.62
Greatwood	TX	29.55	-95.68
Gladeview	FL	25.84	-80.24
Destrehan	LA	29.94	-90.35
Cheney	WA	47.49	-117.58
Richfield	WI	43.26	-88.19
Groveland	FL	28.56	-81.85
Grafton	WI	43.32	-87.95
Shady Hills	FL	28.41	-82.54
Yeadon	PA	39.94	-75.26
Hobe Sound	FL	27.06	-80.14
Byram	MS	32.18	-90.25
Claiborne	LA	32.52	-92.19
Yulee	FL	30.63	-81.61
Excelsior Springs	MO	39.34	-94.23
Rehoboth	MA	41.84	-71.25
Robinson	TX	31.47	-97.11
Cedarburg	WI	43.3	-87.99
Gainesville	VA	38.8	-77.61
Lewisburg	TN	35.45	-86.79
Royse City	TX	32.98	-96.33
Prairie Ridge	WA	47.14	-122.15
Anna	TX	33.35	-96.55
Bellmawr	NJ	39.87	-75.09
North Saint Paul	MN	45.01	-92.99
Hillsborough	CA	37.57	-122.38
Los Alamitos	CA	33.8	-118.07
Endwell	NY	42.11	-76.02
Clute	TX	29.02	-95.4
Fenton	MI	42.8	-83.7
Somerset	KY	37.09	-84.6
Branson	MO	36.64	-93.22
Parker	SC	34.85	-82.45
Mendota	CA	36.75	-120.38
Lakes by the Bay	FL	25.57	-80.33
Mays Chapel	MD	39.43	-76.65
Salem	WI	42.55	-88.11
Haddonfield	NJ	39.89	-75.04
Frederick	CO	40.1	-104.94
Webster	MA	42.05	-71.88
Crossville	TN	35.95	-85.03
Hawaiian Paradise Park	HI	19.59	-154.97
D'Iberville	MS	30.43	-88.89
Summit	IL	41.79	-87.81
Piedmont	CA	37.82	-122.23
Ridgefield	NJ	40.83	-74.01
Lyndon	KY	38.26	-85.6
Ionia	MI	42.99	-85.07
Carnot-Moon	PA	40.52	-80.22
Newcastle	WA	47.54	-122.16
Emmaus	PA	40.54	-75.5
Greentree	NJ	39.9	-74.96
Tyngsboro	MA	42.68	-71.42
Grosse Ile	MI	42.13	-83.14
Jefferson Hills	PA	40.29	-79.93
Ocean City	NJ	39.28	-74.57
Camden	AR	33.58	-92.83
Oxford	CT	41.43	-73.12
Waupun	WI	43.63	-88.73
Niles	MI	41.83	-86.25
North Valley	NM	35.17	-106.62
Oak Hills	OR	45.54	-122.84
Two Rivers	WI	44.15	-87.57
Gloucester City	NJ	39.89	-75.12
Lakewood Park	FL	27.54	-80.4
Smyrna	DE	39.3	-75.6
Fort Morgan	CO	40.25	-103.8
Mango	FL	27.98	-82.31
Gardnerville Ranchos	NV	38.89	-119.74
East Grand Rapids	MI	42.94	-85.61
Magalia	CA	39.81	-121.58
Broussard	LA	30.15	-91.96
Walker Mill	MD	38.88	-76.89
West Sedona	AZ	34.87	-111.81
Robertsville	NJ	40.35	-74.29
Merriam	KS	39.02	-94.69
Madison Heights	VA	37.43	-79.12
Woods Cross	UT	40.87	-111.89
Spearfish	SD	44.49	-103.86
Plano	IL	41.66	-88.54
Warren	RI	41.73	-71.28
Shiloh	OH	39.82	-84.23
Guthrie	OK	35.88	-97.43
Cusseta	GA	32.31	-84.77
Huntington	VA	38.79	-77.07
Communications Hill	CA	37.29	-121.86
Lewis Center	OH	40.2	-83.01
Wrentham	MA	42.07	-71.33
Loganville	GA	33.84	-83.9
Westwood	NJ	40.99	-74.03
Munhall	PA	40.39	-79.9
Yazoo City	MS	32.86	-90.41
Minooka	IL	41.46	-88.26
Campbellsville	KY	37.34	-85.34
Lake Grove	NY	40.85	-73.12
Yorktown	IN	40.17	-85.49
White House	TN	36.47	-86.65
Browns Mills	NJ	39.97	-74.58
Mendota Heights	MN	44.88	-93.14
Grosse Pointe Park	MI	42.38	-82.94
Shiloh	PA	39.98	-76.8
Pike Creek Valley	DE	39.74	-75.7
Beachwood	NJ	39.94	-74.19
Haysville	KS	37.56	-97.35
Spencer	IA	43.14	-95.14
North Smithfield	RI	41.97	-71.55
Orange City	FL	28.95	-81.3
Berkley	CO	39.8	-105.03
Pompton Lakes	NJ	41.01	-74.29
Vernal	UT	40.46	-109.53
River Forest	IL	41.9	-87.81
Saint Peter	MN	44.32	-93.96
Jefferson	LA	29.97	-90.15
Jerome	ID	42.72	-114.52
Springdale	OH	39.29	-84.49
Elwood	NY	40.85	-73.34
Grandview	WA	46.25	-119.9
Leon Valley	TX	29.5	-98.62
North Scituate	RI	41.83	-71.59
Webb City	MO	37.15	-94.46
Dudley	MA	42.05	-71.93
Tarboro	NC	35.9	-77.54
Sierra Madre	CA	34.16	-118.05
Galena Park	TX	29.73	-95.23
Camp Verde	AZ	34.56	-111.85
Oakwood	NY	40.56	-74.12
Mount Kisco	NY	41.2	-73.73
East Renton Highlands	WA	47.48	-122.11
Raymondville	TX	26.48	-97.78
Chino Valley	AZ	34.76	-112.45
Lantana	FL	26.59	-80.05
Oneida	NY	43.09	-75.65
Gulf Shores	AL	30.25	-87.7
Dobbs Ferry	NY	41.01	-73.87
Grand Rapids	MN	47.24	-93.53
Coshocton	OH	40.27	-81.86
Cherry Creek	CO	39.63	-104.88
Webster	TX	29.54	-95.12
Helena-West Helena	AR	34.53	-90.59
Town and Country	MO	38.61	-90.46
Lighthouse Point	FL	26.28	-80.09
Lawrenceburg	KY	38.04	-84.9
Village Park	HI	21.4	-158.03
Fredericksburg	TX	30.28	-98.87
South Yarmouth	MA	41.67	-70.18
Canyon Lake	CA	33.69	-117.27
View Park-Windsor Hills	CA	34	-118.35
East Milton	FL	30.62	-87.02
Leicester	MA	42.25	-71.91
Grand Haven	MI	43.06	-86.23
Peru	IN	40.75	-86.07
Lakeland Highlands	FL	27.96	-81.95
Joint Base Lewis McChord	WA	47.11	-122.58
Saint Albans	WV	38.39	-81.84
Burkburnett	TX	34.1	-98.57
Londonderry	NH	42.87	-71.37
Diamond Springs	CA	38.69	-120.81
Sonoma	CA	38.29	-122.46
Millington	TN	35.34	-89.9
Little Chute	WI	44.28	-88.32
Vermilion-on-the-Lake	OH	41.43	-82.32
Suffern	NY	41.11	-74.15
Ontario	OR	44.03	-116.96
Chalco	NE	41.18	-96.15
West Point	MS	33.61	-88.65
Crestwood	IL	41.64	-87.74
Mountain Top	PA	41.17	-75.88
Doctor Phillips	FL	28.45	-81.49
Totowa	NJ	40.91	-74.21
Spuyten Duyvil	NY	40.88	-73.92
Mitchellville	MD	38.93	-76.74
Little Ferry	NJ	40.85	-74.04
Martin	TN	36.34	-88.85
Union	MO	38.45	-91.01
Damascus	OR	45.42	-122.46
Highland Park	MI	42.41	-83.1
Vidor	TX	30.13	-94.02
Cordele	GA	31.96	-83.78
Bluffdale	UT	40.49	-111.94
Malvern	AR	34.36	-92.81
Seymour	TN	35.89	-83.72
Quartz Hill	CA	34.65	-118.22
Gulf Gate Estates	FL	27.25	-82.51
Storm Lake	IA	42.64	-95.21
Trinity	FL	28.18	-82.68
Fairfield	AL	33.49	-86.91
Lincolnton	NC	35.47	-81.25
Ironton	OH	38.54	-82.68
Franklin Lakes	NJ	41.02	-74.21
Brooklyn	OH	41.44	-81.74
Newman	CA	37.31	-121.02
Summerfield	MD	38.9	-76.87
Corning	NY	42.14	-77.05
Doraville	GA	33.9	-84.28
Sturgis	MI	41.8	-85.42
DeRidder	LA	30.85	-93.29
Ogdensburg	NY	44.69	-75.49
Woodbury	NY	41.36	-74.11
Taylorville	IL	39.55	-89.29
Riverton	WY	43.02	-108.38
Citrus	CA	34.12	-117.89
Summerfield	NC	36.21	-79.9
Show Low	AZ	34.25	-110.03
Acushnet	MA	41.68	-70.91
Waynesboro	PA	39.76	-77.58
East Liverpool	OH	40.62	-80.58
Coldwater	MI	41.94	-85
Highland City	FL	27.97	-81.88
Miami Shores	FL	25.86	-80.19
Winchester Center	CT	41.9	-73.13
Maltby	WA	47.81	-122.11
Burr Ridge	IL	41.75	-87.92
Sedro-Woolley	WA	48.5	-122.24
Lindon	UT	40.34	-111.72
Sweetwater	TX	32.47	-100.41
Pine Castle	FL	28.47	-81.37
Mount Holly	NJ	39.99	-74.79
La Riviera	CA	38.57	-121.36
Marinette	WI	45.1	-87.63
Bellefontaine Neighbors	MO	38.74	-90.23
Van Wert	OH	40.87	-84.58
Muskegon Heights	MI	43.2	-86.24
Monroe	WI	42.6	-89.64
Holbrook	MA	42.16	-71.01
Broomall	PA	39.98	-75.36
Worth	IL	41.69	-87.8
Jacinto City	TX	29.77	-95.23
Smithfield	UT	41.84	-111.83
Farmersville	CA	36.3	-119.21
Crestline	CA	34.24	-117.29
Kings Mountain	NC	35.25	-81.34
Viera East	FL	28.26	-80.71
Lowes Island	VA	39.06	-77.35
Delhi	CA	37.43	-120.78
Roessleville	NY	42.7	-73.81
Sussex	WI	43.13	-88.22
Arkadelphia	AR	34.12	-93.05
Saks	AL	33.7	-85.84
Echelon	NJ	39.85	-75
Collegedale	TN	35.05	-85.05
Vermillion	SD	42.78	-96.93
Minneola	FL	28.57	-81.75
Tamalpais-Homestead Valley	CA	37.88	-122.54
Middlesboro	KY	36.61	-83.72
Lyons	IL	41.81	-87.82
Holly Springs	GA	34.17	-84.5
Fort Madison	IA	40.63	-91.32
Bolivar	MO	37.61	-93.41
Bastrop	LA	32.78	-91.91
Atchison	KS	39.56	-95.12
Largo	MD	38.9	-76.83
Fredonia	NY	42.44	-79.33
Cheval	FL	28.15	-82.51
Halfway	MD	39.62	-77.76
Petal	MS	31.35	-89.26
Kapa‘a	HI	22.08	-159.32
Rosaryville	MD	38.76	-76.81
Somers Point	NJ	39.32	-74.59
Little Falls	NJ	40.87	-74.21
Darby	PA	39.92	-75.26
Vidalia	GA	32.22	-82.41
Gonzales	LA	30.24	-90.92
Grimes	IA	41.69	-93.79
Picayune	MS	30.53	-89.68
Klahanie	WA	47.57	-122.01
Batesville	AR	35.77	-91.64
Northbrook	OH	39.25	-84.58
Kennett	MO	36.24	-90.06
Burlington	WI	42.68	-88.28
Placerville	CA	38.73	-120.8
Garden Acres	CA	37.96	-121.23
Muscoy	CA	34.15	-117.34
Sandy	OR	45.4	-122.26
Lansdowne	PA	39.94	-75.27
Morro Bay	CA	35.37	-120.85
Satellite Beach	FL	28.18	-80.59
Scottdale	GA	33.79	-84.26
Massena	NY	44.93	-74.89
Old Saybrook	CT	41.29	-72.38
Bedford Heights	OH	41.42	-81.53
Vashon	WA	47.45	-122.46
Camp Pendleton South	CA	33.23	-117.38
Forest Acres	SC	34.02	-80.99
Winton	CA	37.39	-120.61
Keokuk	IA	40.4	-91.38
Eureka	MO	38.5	-90.63
Norwell	MA	42.16	-70.79
Gardere	LA	30.35	-91.14
Accokeek	MD	38.67	-77.03
Union City	TN	36.42	-89.06
Vernon	TX	34.16	-99.27
Vienna	WV	39.33	-81.55
Eltingville	NY	40.55	-74.17
Santaquin	UT	39.98	-111.79
North Versailles	PA	40.38	-79.81
Lawrenceburg	TN	35.24	-87.33
Roscoe	IL	42.41	-89.01
Hillsdale	NJ	41	-74.04
Exeter	CA	36.3	-119.14
Belmont	NC	35.24	-81.04
Forestville	OH	39.08	-84.34
Weddington	NC	35.02	-80.76
Farmington	MI	42.46	-83.38
Jackson	WY	43.48	-110.76
Chesapeake Ranch Estates	MD	38.35	-76.42
Fox Lake	IL	42.4	-88.18
Manchester	TN	35.48	-86.09
The Pinery	CO	39.46	-104.73
Pine Hill	NJ	39.78	-74.99
Montgomery	OH	39.23	-84.35
Redwood Shores	CA	37.53	-122.25
Sebring	FL	27.5	-81.44
Dent	OH	39.19	-84.65
Bound Brook	NJ	40.57	-74.54
Sauk Village	IL	41.49	-87.57
Rockport	TX	28.02	-97.06
Heath	OH	40.02	-82.44
Ventnor City	NJ	39.34	-74.48
Middle Island	NY	40.88	-72.94
Arizona City	AZ	32.76	-111.67
Richmond Heights	OH	41.55	-81.51
Wyomissing	PA	40.33	-75.97
Burley	ID	42.54	-113.79
Vermilion	OH	41.42	-82.36
Key Largo	FL	25.09	-80.45
Warr Acres	OK	35.52	-97.62
Canandaigua	NY	42.87	-77.29
Manville	NJ	40.54	-74.59
West Haverstraw	NY	41.21	-73.99
Lincoln Park	NJ	40.92	-74.3
Melvindale	MI	42.28	-83.18
Cambridge	OH	40.03	-81.59
Greencastle	IN	39.64	-86.86
Big Rapids	MI	43.7	-85.48
Kinnelon	NJ	41	-74.37
Palatka	FL	29.65	-81.64
Columbia	PA	40.03	-76.5
Sedona	AZ	34.87	-111.76
Celina	OH	40.55	-84.57
Norfolk	MA	42.12	-71.33
Portage	WI	43.54	-89.46
Wabash	IN	40.8	-85.82
Struthers	OH	41.05	-80.61
Cadillac	MI	44.25	-85.4
Big Lake	MN	45.33	-93.75
Pella	IA	41.41	-92.92
Castle Pines North	CO	39.47	-104.89
Mount Airy	NC	36.5	-80.61
Barrington	IL	42.15	-88.14
Durham	NH	43.13	-70.93
West Point	UT	41.12	-112.08
Silver Springs	FL	29.22	-82.06
Newberry	SC	34.27	-81.62
Linthicum	MD	39.21	-76.65
Reading	OH	39.22	-84.44
Bluefield	WV	37.27	-81.22
Little Canada	MN	45.03	-93.09
Eunice	LA	30.49	-92.42
Wood River	IL	38.86	-90.1
Hull	MA	42.3	-70.91
Oak Grove	SC	33.98	-81.14
Morris Park	NY	40.85	-73.85
Newport	OR	44.64	-124.05
Beverly Hills	MI	42.52	-83.22
Edwards	CO	39.64	-106.59
Cedar Hills	UT	40.41	-111.76
Pleasant Grove	AL	33.49	-86.97
Lancaster	NY	42.9	-78.67
Nanticoke	PA	41.21	-76
Milford	DE	38.91	-75.43
Rossmoor	CA	33.79	-118.09
Timberlane	LA	29.88	-90.03
Sleepy Hollow	NY	41.09	-73.86
Fairview Shores	FL	28.59	-81.39
Waterloo	IL	38.34	-90.15
Alpine	UT	40.45	-111.78
Beecher	MI	43.09	-83.69
Fairmount	NY	43.05	-76.24
Española	NM	35.99	-106.08
Berwick	PA	41.05	-76.23
Roma	TX	26.41	-99.02
Fairmont	MN	43.65	-94.46
River Grove	IL	41.93	-87.84
Anderson	CA	40.45	-122.3
North Branch	MN	45.51	-92.98
Watervliet	NY	42.73	-73.7
Vail	AZ	32.05	-110.71
Gages Lake	IL	42.35	-87.98
Jefferson	GA	34.12	-83.57
Raceland	LA	29.73	-90.6
Columbia	IL	38.44	-90.2
Bel Air	MD	39.54	-76.35
Capitola	CA	36.98	-121.95
North Logan	UT	41.77	-111.8
Jennings	LA	30.22	-92.66
Bohemia	NY	40.77	-73.12
Alpena	MI	45.06	-83.43
Bellmead	TX	31.59	-97.11
Forestdale	AL	33.57	-86.9
Wells Beach Station	ME	43.32	-70.59
Lake Morton-Berrydale	WA	47.33	-122.1
Gold Camp	AZ	33.29	-111.3
Shasta Lake	CA	40.68	-122.37
Gold Canyon	AZ	33.37	-111.44
Lanham	MD	38.97	-76.86
Paris	TN	36.3	-88.33
Great Neck	NY	40.8	-73.73
East Stroudsburg	PA	41	-75.18
Oil City	PA	41.43	-79.71
Norwalk	IA	41.48	-93.68
Marlton	NJ	39.89	-74.92
Galion	OH	40.73	-82.79
Denham Springs	LA	30.49	-90.96
Fort Knox	KY	37.89	-85.96
Essex Junction	VT	44.49	-73.11
San Diego Country Estates	CA	33.01	-116.78
Maynard	MA	42.43	-71.45
Goulds	FL	25.56	-80.38
Waldwick	NJ	41.01	-74.12
Port Salerno	FL	27.14	-80.2
Parsons	KS	37.34	-95.26
Comstock Park	MI	43.04	-85.67
Avon Park	FL	27.6	-81.51
Inwood	NY	40.87	-73.93
Mayfield	KY	36.74	-88.64
Bonham	TX	33.58	-96.18
Lexington	NE	40.78	-99.74
Countryside	VA	39.04	-77.41
Waverly	IA	42.73	-92.48
Canyon Rim	UT	40.71	-111.82
London	OH	39.89	-83.45
North Andrews Gardens	FL	26.19	-80.14
Clinton	TN	36.1	-84.13
Atmore	AL	31.02	-87.49
Little Neck	NY	40.76	-73.73
Oregon	WI	42.93	-89.38
Poulsbo	WA	47.74	-122.65
Troy	IL	38.73	-89.88
New Port Richey East	FL	28.26	-82.69
Plymouth	IN	41.34	-86.31
Monmouth	OR	44.85	-123.23
Grantsville	UT	40.6	-112.46
Elon	NC	36.1	-79.51
Woodbury	NJ	39.84	-75.15
Waggaman	LA	29.92	-90.21
Fort Salonga	NY	40.91	-73.3
Bluffton	IN	40.74	-85.17
Silver City	NM	32.77	-108.28
Fairview	CA	37.68	-122.05
Del Aire	CA	33.92	-118.37
#UY
Montevideo	10	-34.9	-56.19
Salto	15	-31.38	-57.97
Paysandú	11	-32.32	-58.08
Las Piedras	02	-34.73	-56.22
Rivera	13	-30.91	-55.55
Maldonado	09	-34.9	-54.95
Tacuarembó	18	-31.72	-55.98
Melo	03	-32.37	-54.17
#UZ
Tashkent	13	41.26	69.22
Namangan	06	41	71.67
Samarkand	10	39.65	66.96
Andijon	01	40.78	72.34
Bukhara	02	39.77	64.43
Nukus	09	42.45	59.61
Qarshi	08	38.86	65.79
Qo‘qon	03	40.53	70.94
Chirchiq	14	41.47	69.58
Fergana	03	40.38	71.78
Jizzax	15	40.12	67.83
Urganch	05	41.55	60.63
Tirmiz	12	37.22	67.28
Marg‘ilon	03	40.47	71.72
Navoiy	07	40.08	65.38
Angren	14	41.02	70.14
Olmaliq	14	40.84	69.6
Bekobod	14	40.22	69.27
Denov	12	38.27	67.9
Chust	06	41	71.24
Kogon Shahri	02	39.73	64.55
Yangiyŭl	14	41.11	69.05
Koson	08	39.04	65.58
Kattaqo’rg’on Shahri	10	39.91	66.27
Oltinko‘l	09	43.07	58.9
Shahrisabz	08	39.06	66.83
Asaka	01	40.64	72.24
Khiwa	05	41.38	60.36
Guliston	16	40.49	68.78
Beruniy	09	41.69	60.75
Xo‘jayli Shahri	09	42.41	59.45
#VE
Caracas	25	10.49	-66.88
Maracaibo	23	10.67	-71.61
Maracay	04	10.24	-67.59
Valencia	07	10.16	-68.01
Barquisimeto	13	10.06	-69.36
Ciudad Guayana	06	8.35	-62.64
Barcelona	02	10.14	-64.69
Maturín	16	9.75	-63.18
Puerto La Cruz	02	10.21	-64.63
Petare	15	10.48	-66.81
Barinas	05	8.62	-70.21
Turmero	04	10.23	-67.47
Ciudad Bolívar	06	8.13	-63.54
Mérida	14	8.59	-71.16
Alto Barinas	05	8.59	-70.23
Santa Teresa del Tuy	15	10.23	-66.66
Cumaná	19	10.45	-64.18
San Cristóbal	20	7.77	-72.22
Baruta	15	10.43	-66.88
Mucumpiz	14	8.42	-71.13
Cabimas	23	10.4	-71.45
Coro	11	11.4	-69.67
Guatire	15	10.47	-66.54
Cúa	15	10.16	-66.88
Guarenas	15	10.47	-66.62
Puerto Cabello	07	10.47	-68.01
Ocumare del Tuy	15	10.12	-66.78
Guacara	07	10.23	-67.88
El Tigre	02	8.89	-64.25
El Limón	04	10.31	-67.63
Acarigua	18	9.55	-69.2
Los Teques	15	10.34	-67.04
Punto Fijo	11	11.69	-70.2
Charallave	15	10.24	-66.86
Palo Negro	04	10.17	-67.54
Cagua	04	10.19	-67.46
Anaco	02	9.43	-64.46
Calabozo	12	8.92	-67.43
Guanare	18	9.04	-69.74
Carúpano	19	10.67	-63.25
Ejido	14	8.55	-71.24
Catia La Mar	26	10.61	-67.03
Mariara	07	10.3	-67.72
Carora	13	10.17	-70.08
Valera	21	9.32	-70.6
Yaritagua	22	10.08	-69.12
Valle de La Pascua	12	9.22	-66.01
San Juan de los Morros	12	9.91	-67.35
Porlamar	17	10.96	-63.87
La Victoria	04	10.23	-67.33
Tinaquillo	08	9.92	-68.3
El Cafetal	15	10.47	-66.83
San Fernando de Apure	03	7.89	-67.47
San Carlos	08	9.66	-68.58
San Felipe	22	10.34	-68.74
Villa de Cura	04	10.04	-67.49
Araure	18	9.58	-69.24
Güigüe	07	10.08	-67.78
La Villa del Rosario	23	10.33	-72.31
Chacao	15	10.5	-66.85
San Antonio de Los Altos	15	10.39	-66.95
Machiques	23	10.06	-72.55
San José de Guanipa	02	8.89	-64.17
El Vigía	14	8.61	-71.66
Caucaguita	15	10.36	-66.8
Punta Cardón	11	11.66	-70.21
Los Dos Caminos	15	10.49	-66.83
El Hatillo	15	10.42	-66.83
La Dolorita	15	10.49	-66.79
San Carlos del Zulia	23	9	-71.93
Upata	06	8.02	-62.41
El Tocuyo	13	9.79	-69.79
Maiquetía	26	10.59	-66.96
Caucagüito	15	10.49	-66.74
Puerto Ayacucho	01	5.66	-67.58
Rubio	20	7.7	-72.36
Tucupita	09	9.06	-62.05
San Mateo	04	10.21	-67.42
#VI
Saint Croix	010	17.73	-64.75
#VN
Ho Chi Minh City	20	10.82	106.63
Hanoi	44	21.02	105.84
Da Nang	78	16.07	108.22
Haiphong	13	20.86	106.68
Biên Hòa	43	10.94	106.82
Huế	66	16.46	107.6
Nha Trang	54	12.25	109.19
Cần Thơ	87	10.04	105.79
Rạch Giá	21	10.01	105.08
Thị Xã Phú Mỹ	45	10.57	107.13
Qui Nhon	46	13.78	109.22
Vũng Tàu	45	10.35	107.08
Sa Dec	09	10.29	105.76
Ðà Lạt	23	11.95	108.44
Nam Định	82	20.43	106.18
Vinh	58	18.67	105.69
Đưc Trọng	23	11.74	108.37
Phan Thiết	47	10.93	108.1
La Gi	47	10.66	107.77
Long Xuyên	01	10.39	105.44
Cần Giuộc	24	10.61	106.67
Bảo Lộc	23	11.55	107.81
Hạ Long	30	20.95	107.07
Buôn Ma Thuột	88	12.67	108.04
Cam Ranh	54	11.92	109.16
Cẩm Phả Mines	30	21.02	107.3
Thái Nguyên	85	21.59	105.85
Mỹ Tho	37	10.36	106.36
Sóc Trăng	65	9.6	105.97
Pleiku	49	13.98	108
Thanh Hóa	34	19.8	105.77
Cà Mau	77	9.18	105.15
Bạc Liêu	73	9.29	105.73
Yên Vinh	58	18.67	105.67
Hòa Bình	53	20.82	105.34
Vĩnh Long	69	10.25	105.97
Yên Bái	70	21.72	104.91
Sông Cầu	61	13.46	109.22
Việt Trì	83	21.32	105.4
Phan Rang-Tháp Chàm	60	11.56	108.99
Thủ Dầu Một	75	10.98	106.65
Cung Kiệm	74	21.19	106.16
Củ Chi	20	10.97	106.49
Móng Cái	30	21.52	107.97
Cho Dok	01	10.7	105.12
Tuy Hòa	61	13.1	109.32
Tân An	24	10.54	106.41
Thành Phố Uông Bí	30	21.03	106.77
Cao Lãnh	09	10.46	105.63
Bến Tre	03	10.24	106.38
Tam Kỳ	84	15.57	108.47
Hải Dương	79	20.94	106.33
Trà Vinh	67	9.95	106.34
Lạng Sơn	39	21.85	106.76
Cần Giờ	20	10.41	106.95
Bỉm Sơn	34	20.08	105.86
Bắc Giang	71	21.27	106.19
Thái Bình	35	20.45	106.34
Hà Đông	44	20.97	105.78
#XK
Pristina	10097360	42.67	21.17
Prizren	10097361	42.21	20.74
Mitrovicë	10097358	42.88	20.87
Gjakovë	10096859	42.38	20.43
Suva Reka	10097361	42.36	20.83
Ferizaj	10096138	42.37	21.16
Glogovac	10097360	42.63	20.89
Gjilan	10097357	42.46	21.47
Deçan	10096859	42.54	20.29
#YE
Sanaa	16	15.35	44.21
Al Ḩudaydah	08	14.8	42.95
Ta‘izz	25	13.58	44.02
Aden	02	12.78	45.04
Mukalla	04	14.54	49.12
Ibb	23	13.97	44.18
Dhamār	11	14.54	44.41
‘Amrān	19	15.66	43.94
Sayyān	16	15.17	44.32
Zabīd	08	14.2	43.32
Sa'dah	15	16.94	43.76
#YT
Mamoudzou	97611	-12.78	45.23
#ZA
Cape Town	11	-33.93	18.42
Durban	02	-29.86	31.03
Johannesburg	06	-26.2	28.04
Soweto	06	-26.27	27.86
Pretoria	06	-25.74	28.19
Port Elizabeth	05	-33.96	25.61
Pietermaritzburg	02	-29.62	30.39
Benoni	06	-26.19	28.32
Tembisa	06	-26	28.23
East London	05	-33.02	27.91
Vereeniging	06	-26.67	27.93
Bloemfontein	03	-29.12	26.21
Boksburg	06	-26.21	28.26
Welkom	03	-27.98	26.74
Newcastle	02	-27.76	29.93
Krugersdorp	06	-26.09	27.78
Diepsloot	06	-25.93	28.01
Randburg	06	-26.09	28
Botshabelo	03	-29.27	26.73
Brakpan	06	-26.24	28.37
Witbank	07	-25.87	29.23
Richards Bay	02	-28.78	32.04
Vanderbijlpark	06	-26.71	27.84
Centurion	06	-25.86	28.19
Uitenhage	05	-33.76	25.4
Roodepoort	06	-26.16	27.87
Paarl	11	-33.73	18.98
Springs	06	-26.25	28.4
Carletonville	06	-26.36	27.4
Klerksdorp	10	-26.85	26.67
Midrand	06	-25.99	28.13
Westonaria	06	-26.32	27.65
Middelburg	07	-25.78	29.46
Vryheid	02	-27.77	30.79
Orkney	10	-26.98	26.67
Kimberley	08	-28.73	24.76
eMbalenhle	07	-26.53	29.07
Nigel	06	-26.43	28.48
Mpumalanga	02	-29.81	30.64
Bhisho	05	-32.85	27.44
Randfontein	06	-26.18	27.7
Worcester	11	-33.65	19.45
Rustenburg	10	-25.67	27.24
Polokwane	09	-23.9	29.47
Potchefstroom	10	-26.72	27.1
Virginia	03	-28.1	26.87
Brits	10	-25.63	27.78
Alberton	06	-26.27	28.12
Nelspruit	07	-25.47	30.97
Phalaborwa	09	-23.94	31.14
Queenstown	05	-31.9	26.88
Kroonstad	03	-27.65	27.23
Bethal	07	-26.46	29.47
Mokopane	09	-24.19	29.01
Mabopane	06	-25.5	28.1
Kutloanong	03	-27.83	26.75
Stellenbosch	11	-33.93	18.87
Stilfontein	10	-26.84	26.77
Delmas	07	-26.15	28.68
Grahamstown	05	-33.3	26.53
Warmbaths	09	-24.88	28.28
Louis Trichardt	09	-23.04	29.9
Dundee	02	-28.17	30.23
Piet Retief	07	-27.01	30.81
Phuthaditjhaba	03	-28.52	28.82
Bethlehem	03	-28.23	28.31
Mthatha	05	-31.59	28.78
Sasolburg	03	-26.81	27.82
Mmabatho	10	-25.85	25.63
Standerton	07	-26.93	29.24
Bothaville	03	-27.39	26.62
Upington	08	-28.45	21.26
Parys	03	-26.9	27.46
Schweizer-Reneke	10	-27.19	25.33
Ga-Rankuwa	10	-25.62	27.99
Knysna	11	-34.04	23.05
Saldanha	11	-33.01	17.94
Barberton	07	-25.79	31.05
Lichtenburg	10	-26.15	26.16
Heidelberg	06	-26.5	28.36
Graaff-Reinet	05	-32.25	24.53
Fochville	10	-26.49	27.49
Oudtshoorn	11	-33.6	22.2
Atlantis	11	-33.57	18.48
KwaDukuza	02	-29.33	31.29
Mossel Bay	11	-34.18	22.15
Fort Beaufort	05	-32.77	26.63
Kraaifontein	11	-33.85	18.72
Wellington	11	-33.64	19.01
Heilbron	03	-27.28	27.97
Viljoenskroon	03	-27.21	26.95
Port Shepstone	02	-30.74	30.45
#ZM
Lusaka	09	-15.41	28.29
Kitwe	08	-12.8	28.21
Ndola	08	-12.96	28.64
Kabwe	02	-14.45	28.45
Chingola	08	-12.53	27.88
Mufulira	08	-12.55	28.24
Luanshya	08	-13.14	28.42
Livingstone	07	-17.84	25.85
Kasama	05	-10.21	31.18
Chipata	03	-13.63	32.65
Kalulushi	08	-12.84	28.09
Mazabuka	07	-15.86	27.75
Chililabombwe	08	-12.36	27.82
Mongu	01	-15.25	23.13
#ZW
Harare	10	-17.83	31.05
Bulawayo	09	-20.15	28.58
Chitungwiza	10	-18.01	31.08
Mutare	01	-18.97	32.67
Gweru	02	-19.45	29.82
Epworth	10	-17.89	31.15
Kwekwe	02	-18.93	29.81
Kadoma	05	-18.33	29.92
Masvingo	08	-20.06	30.83
Chinhoyi	05	-17.37	30.2
Marondera	04	-18.19	31.55
Norton	05	-17.88	30.7`;

export const US_STATE_CENTROIDS = `AK	61.27	-148.84
AL	33.02	-86.73
AR	35.19	-92.69
AZ	33.34	-111.92
CA	35.33	-119.3
CO	39.58	-105.13
CT	41.45	-72.92
DC	38.9	-77.04
DE	39.44	-75.59
FL	27.63	-81.5
GA	33.28	-83.85
HI	21.14	-157.54
IA	41.92	-92.98
ID	44.21	-115.34
IL	41.48	-88.2
IN	40.21	-86.27
KS	38.48	-96.32
KY	38.08	-84.8
LA	30.58	-91.34
MA	42.28	-71.33
MD	39.14	-76.8
ME	44.18	-69.83
MI	42.72	-83.98
MN	45.08	-93.44
MO	38.57	-92.29
MS	32.4	-89.6
MT	46.68	-111.13
NC	35.54	-79.59
ND	47.33	-99.27
NE	41.14	-97.09
NH	43.12	-71.44
NJ	40.48	-74.39
NM	34.65	-106.36
NV	36.93	-116.09
NY	41	-74.18
OH	40.52	-82.75
OK	35.63	-96.97
OR	44.85	-122.63
PA	40.39	-76.84
RI	41.75	-71.45
SC	33.86	-80.93
SD	43.96	-98.87
TN	35.66	-87.16
TX	30.97	-97.54
UT	40.46	-111.95
VA	37.78	-77.43
VT	44.09	-72.87
WA	47.34	-121.66
WI	43.53	-88.82
WV	38.92	-80.93
WY	42.57	-106.87`;

export const COUNTRY_CENTROIDS = `AD	42.52	1.54
AE	25.07	55.26
AF	34.64	67.96
AG	17.13	-61.83
AI	18.2	-63.07
AL	41.08	19.86
AM	40.28	44.58
AO	-9.77	13.95
AQ	-77.85	166.68
AR	-33.11	-60.81
AS	-14.31	-170.69
AT	47.8	14.86
AU	-33.07	144.5
AW	12.51	-69.99
AX	60.16	20.01
AZ	40.29	48.57
BA	44.24	17.85
BB	13.11	-59.62
BD	23.58	90.39
BE	50.85	4.43
BF	12.18	-2.08
BG	42.75	25.01
BH	26.18	50.57
BI	-3.33	29.65
BJ	7.56	2.3
BL	17.9	-62.85
BM	32.35	-64.71
BN	4.76	114.65
BO	-17.6	-65.32
BQ	13.99	-66.57
BR	-18.06	-45.62
BS	25.45	-77.64
BT	27.3	89.97
BW	-23.29	25.96
BY	53.58	27.89
BZ	17.46	-88.46
CA	46.5	-87.67
CC	-12.16	96.82
CD	-4.85	19.9
CF	4.95	18.64
CG	-4.18	14.1
CH	47.08	8.06
CI	6.09	-4.63
CK	-21.21	-159.78
CL	-33.74	-71.21
CM	5.9	11.51
CN	32.97	115.29
CO	5.95	-74.87
CR	9.97	-84.15
CU	22.11	-80.02
CV	15.7	-23.98
CW	12.12	-68.94
CX	-10.42	105.68
CY	35	33.32
CZ	49.85	15.61
DE	50.99	9.81
DJ	11.57	43.09
DK	55.83	11.21
DM	15.38	-61.37
DO	18.77	-70.13
DZ	35.66	3.66
EC	-1.45	-79.37
EE	59.08	25.58
EG	29.9	31.17
EH	26.22	-13.93
ER	15.28	39
ES	39.71	-2.98
ET	9.29	38.71
FI	61.68	24.94
FJ	-17.7	178.11
FK	-51.69	-57.86
FM	7.2	153.7
FO	62.01	-6.82
FR	47.04	2.76
GA	-0.13	10.13
GB	52.64	-1.55
GD	12.13	-61.7
GE	41.96	43.69
GF	5.02	-52.73
GG	49.46	-2.54
GH	6.37	-0.88
GI	36.14	-5.35
GL	65.41	-50.64
GM	13.42	-16.28
GN	9.62	-13.11
GP	16.21	-61.55
GQ	2.53	9.57
GR	38.64	23.38
GS	-54.28	-36.51
GT	14.77	-90.73
GU	13.47	144.79
GW	11.88	-15.5
GY	6.61	-58.13
HK	22.29	114.17
HN	14.8	-87.49
HR	45.2	16.35
HT	18.74	-72.51
HU	47.34	19.38
ID	-4.97	109.15
IE	53.15	-6.96
IL	32.08	34.97
IM	54.18	-4.51
IN	21.71	78.5
IQ	33.42	44.94
IR	34.46	51.49
IS	64.31	-21.33
IT	42.85	12.11
JE	49.19	-2.1
JM	18.04	-76.94
JO	32	35.97
JP	35.62	137.21
KE	-1.21	37.02
KG	42.12	74.25
KH	11.68	104.63
KI	1.44	153.67
KM	-12	43.94
KN	17.28	-62.72
KP	39.5	126.48
KR	36.61	127.5
KW	29.2	48.06
KY	19.3	-81.35
KZ	47.24	70.7
LA	17.9	103.62
LB	33.86	35.51
LC	13.95	-60.98
LI	47.16	9.52
LK	7.29	80.22
LR	6.35	-10.44
LS	-29.47	27.74
LT	55.12	24.02
LU	49.62	6.08
LV	56.83	24.28
LY	31.84	15.55
MA	33.54	-6.59
MC	43.74	7.42
MD	47.11	28.76
ME	42.55	19.17
MF	18.07	-63.08
MG	-19.12	47.46
MH	7.66	169.98
MK	41.76	21.5
ML	13.09	-6.97
MM	18.37	96.22
MN	47.94	105.03
MO	22.2	113.55
MP	15.15	145.72
MQ	14.63	-61
MR	18.1	-14.84
MS	16.79	-62.21
MT	35.9	14.46
MU	-20.23	57.59
MV	3.6	73.39
MW	-14.27	34.38
MX	21.17	-100.24
MY	3.81	104.11
MZ	-21.1	34.87
NA	-21.74	17.1
NC	-21.85	166.25
NE	14.04	5.09
NF	-29.05	167.97
NG	8.12	6.24
NI	12.36	-86.11
NL	52.07	5.28
NO	60.92	9.83
NP	27.61	84.88
NR	-0.53	166.93
NU	-19.05	-169.92
NZ	-39.71	174.34
OM	23.2	57.59
PA	8.86	-80.08
PE	-11.1	-76.48
PF	-17.46	-149.49
PG	-7.34	147.21
PH	12.17	122.41
PK	29.63	70.99
PL	51.71	19.27
PM	46.83	-56.21
PN	-25.07	-130.1
PR	18.31	-66.29
PS	31.76	34.91
PT	39.49	-9.34
PW	7.35	134.47
PY	-25.32	-57.05
QA	25.31	51.47
RE	-21.09	55.46
RO	45.6	25.34
RS	44.6	20.56
RU	54.29	52.88
RW	-1.99	29.89
SA	23.9	43.25
SB	-9.29	159.81
SC	-4.65	55.46
SD	14.62	31.9
SE	58.82	15.79
SG	1.3	103.85
SH	-16.92	-10.19
SI	46.16	14.8
SJ	78.17	15.48
SK	48.64	19.03
SL	8.38	-12.37
SM	43.95	12.46
SN	14.66	-16.83
SO	3.78	45.06
SR	5.8	-55.23
SS	6.85	29.96
ST	0.36	6.74
SV	13.7	-89.09
SX	18.05	-63.06
SY	34.96	36.98
SZ	-26.47	31.35
TC	21.46	-71.14
TD	11.39	16.42
TF	-49.35	70.22
TG	7.3	1.13
TH	13.82	100.79
TJ	38.75	69.21
TK	-8.9	-172.11
TL	-8.69	125.65
TM	38.78	59.65
TN	35.81	10.16
TO	-20.8	-175.01
TR	39.59	32.1
TT	10.47	-61.39
TV	-8.26	178.88
TW	24.49	121.2
TZ	-5.96	36.17
UA	48.67	32.37
UG	0.71	32.3
US	37.61	-92.77
UY	-34.08	-56.26
UZ	40.67	68.1
VA	41.9	12.45
VC	13.17	-61.22
VE	9.99	-67.8
VG	18.43	-64.62
VI	17.92	-64.8
VN	14.46	106.74
VU	-16.99	167.95
WF	-13.66	-176.91
WS	-13.8	-171.89
XK	42.56	20.93
YE	14.6	44.44
YT	-12.8	45.18
ZA	-28.75	26.86
ZM	-14.02	28.32
ZW	-18.55	30.45`;
