const { createHash } = require("crypto");
const { readFileSync, writeFile } = require('fs');
const clc = require('cli-color');
const { schedule } = require('node-cron');
const webPush = require("web-push");
const express = require('express');
const app = express();

const CLIENT = "https://raspored.strukovnasamobor.com";

let subscriptionInfo;

let userSubscriptions = JSON.parse(readFileSync('./userSubscriptions.json'));

// mora biti privatno
function saveUserSubscriptionsToFile() {
	writeFile("userSubscriptions.json", JSON.stringify(userSubscriptions), (err) => {
		if (err) throw err;
		console.log("\n", clc.bgYellowBright('[UPDATE FILE] userSubscriptions.json'));
	});
}

app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", CLIENT);
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	next();
});

app.use(express.json());

app.get('/vapidPublicKey', (req, res) => {
	res.send(process.env.VAPID_PUBLIC_KEY);
});

function getRaspHashesFromFile() {
	return JSON.parse(readFileSync('./raspHashes.json'));
}

function initializeUserSubscriptionsObj() {
	let raspHashesFile = getRaspHashesFromFile();
	for (let ras in raspHashesFile) {
		userSubscriptions[ras] = [];
	}
}

if(!Object.keys(userSubscriptions).length)
	initializeUserSubscriptionsObj();
	
app.post('/register', (req, res) => {
	subscriptionInfo = req.body.subscription;
	let rasporedSelection = req.body.razred;
	if (Object.keys(userSubscriptions).includes(rasporedSelection)) {
		userSubscriptions[rasporedSelection].push(subscriptionInfo);
		res.sendStatus(201);
	} else {
		res.sendStatus(422);
	}

});

app.listen(3000, () => {
	console.log('server started!');
});

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
	console.log(
		"You must set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY " +
		"environment variables. You can use the following ones:"
	);
	console.log(webPush.generateVAPIDKeys());
	return;
}

webPush.setVapidDetails(
	CLIENT,
	process.env.VAPID_PUBLIC_KEY,
	process.env.VAPID_PRIVATE_KEY
);

let raspHashes = {};

async function updateHashes({silentUpdate}) {
	const response = await fetch("https://raspored.strukovnasamobor.com/rasporediRazreda.json");
	const data = await response.json();

	let raspHashesFile = getRaspHashesFromFile();

	console.log("\n", clc.bgYellowBright('[STARTING REFRESH]'));
	console.log(clc.bgRedBright('(UPDATED)'), clc.bgGreenBright('(UNCHANGED)'), "\n");

	for (razred in data) {
		const rasporedUrl = data[razred]["RASPORED"];

		const rasporedRawResponse = await fetch(rasporedUrl);
		const html = await rasporedRawResponse.text();

		let toHash = html.substring(html.indexOf(`<body class="docs-gm">`) + 1, html.lastIndexOf("<script"));

		const regex = /(href="\S*"|id="\S*")/gm;
    // zakomentirati za testiranje
		toHash = toHash.replace(regex, "*");
		let hash = createHash("md5").update(toHash).digest("hex");
		if (hash === raspHashesFile[razred]) { // UNCHANGED
			console.log(clc.bgGreenBright(`${razred} - ${hash}`));
		} else {
			console.log(clc.bgRedBright(`${razred} - ${hash}`));
      if(silentUpdate === false){
			console.log(clc.italic(` > Notifying: ${userSubscriptions[razred].length} users`));
			userSubscriptions[razred].forEach((userSub) => {
    			webPush.sendNotification(userSub, "Promjena Rasporeda!");
			});
		}}
		raspHashes[razred] = hash;

	}
	console.log("\n", clc.bgYellowBright("[REFRESH FINISH] result:"));
	console.log(raspHashes);
	writeFile("raspHashes.json", JSON.stringify(raspHashes), (err) => {
		if (err) throw err;
		console.log("\n", clc.bgYellowBright('[UPDATE FILE] raspHashes.json'));
	});
}

app.get('/raspored_update', (req, res) => {
	updateHashes({silentUpdate: true});
  res.statusCode(200);
});

// formula za vrijeme: https://crontab.guru/examples.html
// svakih sat vremena '0 * * * *''
// svaka minuta '* * * * *''
schedule('* * * * *', () => {
	updateHashes({silentUpdate: false});
});

schedule('* * * * *', () => {
	saveUserSubscriptionsToFile();
});