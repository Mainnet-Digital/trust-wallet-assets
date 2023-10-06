const fs = require('fs');
const path = require('path');
const util = require('util')
const axios = require('axios');
const URL = 'http://127.0.0.1:1337'

const logFilePath = path.join(__dirname, 'failed.json'); // Replace 'log.txt' with your desired file name and path

// Create an array to store log messages
const logMessages = [];

// Create a writable stream to the log JSON file
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' }); // 'a' flag appends to the file

// Override console.log to capture log messages
console.log = function (data) {
    logMessages.push(data);
    process.stdout.write(data + '\n'); // Also print to the console
};

// Function to save log messages to the JSON file
function saveLogsToFile() {
    fs.writeFileSync(logFilePath, JSON.stringify(logMessages, null, 2));
}

// Handle process exit to save logs before the program exits
process.on('exit', () => {
    saveLogsToFile();
});


const traverse = function getAllInfoJsonFiles(directoryPath, parentDirName = '', fileArray = []) {
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const fileStat = fs.statSync(filePath);

        if (fileStat.isDirectory()) {
            if (path.basename(filePath) !== 'validators') {
                // If it's a directory (excluding 'validators'), recursively search it
                getAllInfoJsonFiles(filePath, getNameAfterFirstSlash(filePath), fileArray);
            }
        } else if (file === 'info.json') {
            // If the file name is exactly "info.json", add an object with path, parent directory name, and logo properties to the array
            const logoPath = path.resolve(directoryPath, 'logo.png');
            fileArray.push({ path: path.resolve(filePath), parentDirName, logo: logoPath });
        }
    }

    return fileArray;
}

function getNameAfterFirstSlash(filePath) {
    const parts = filePath.split('/');
    if (parts.length >= 2) {
        return parts[1]; // Index 1 corresponds to the name after the first /
    } else {
        return null; // Return null or handle the case where there aren't enough slashes
    }
}

const result = traverse('blockchains')

// console.log(util.inspect(result, false, null))

function convertJsonFilesToObject(filePaths) {
    const networks = [];
    const tokens = [];
    for (const filePath of filePaths) {
        try {
            const jsonContent = fs.readFileSync(filePath.path, 'utf8');
            const jsonObject = JSON.parse(jsonContent);
            jsonObject.chain = filePath.parentDirName
            jsonObject.logo = filePath.logo

            if ('id' in jsonObject) {
                tokens.push(jsonObject);
            } else {
                networks.push(jsonObject);
            }
        } catch (error) {
            console.error(`Error reading or parsing JSON in file: ${filePath.path}`);
        }
    }

    return { networks, tokens };
}

function readTokens() {
    // Specify the path to the JSON file
    const filePath = 'token_log.json';

    try {
        // Read the JSON file
        const jsonData = fs.readFileSync(filePath, 'utf8');

        // Parse the JSON data into a JavaScript object
        const jsonObject = JSON.parse(jsonData);

        // Now, 'jsonObject' contains the parsed data
        return jsonObject
    } catch (error) {
        console.error('Error reading or parsing the JSON file:', error.message);
    }
}
const objects = convertJsonFilesToObject(result)
const tokens = readTokens()

async function convertToken(fullToken) {
    const newToken = mapToken(fullToken)
    const networkId = await findNetwork(fullToken.chain)
    newToken.network = networkId.id
    return newToken
}


async function findNetwork(chain) {
    try {
        const correspondingNetwork = await axios.get(`${URL}/api/networks?filters[chain]=${chain}`)
        return correspondingNetwork.data.data[0]
    } catch (err) {
        return null
    }
}
async function findToken(token) {
    try {
        const correspondingToken = await axios.get(`${URL}/api/tokens?filters[chain]=${token.chain}&filters[address]=${token.id}`)
        return correspondingToken.data.data[0]
    } catch (err) {
        return null
    }
}

async function postToken(newToken) {
    const tokenResponse = await axios.post(`${URL}/api/tokens`, { data: newToken })
    const uploadedToken = tokenResponse.data
    return uploadedToken.data.id
}

async function getFailed() {
    for (t of tokens) {
        const token = JSON.parse(t)
        try {
            if (!token.success) {
                // Failed
                const exist = await findToken(token)
                if (exist) {
                    continue
                }
                const fullToken = objects.tokens.filter(x => x.id === token.id && x.chain === token.token)[0]
                const formatted = await convertToken(fullToken)
                const tokenId = await postToken(formatted)
                const toLog = {
                    success: true,
                    status: 'CREATED',
                    id: tokenId,
                    chain: token.chain
                }
                console.log(JSON.stringify(toLog))
            } else {
                continue
            }
        }
        catch (err) {
            console.log(JSON.stringify({
                success: false,
                token: token.chain,
                error: err
            }))
        }
    }
}

getFailed()

function mapToken(token) {
    const mapped = {
        name: token.name,
        symbol: token.symbol,
        address: token.id,
        description: token.description,
        decimals: token.decimals,
        website: token.website,
        explorer: token.explorer,
        chain: token.chain
    }
    return mapped
}