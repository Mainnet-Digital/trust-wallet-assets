const fs = require("fs");
const path = require("path");
const util = require("util");
const axios = require("axios");
const URL = "https://mnd-backend-staging-da5sx.ondigitalocean.app";
const FormData = require("form-data");

const logFilePath = path.join(__dirname, "temp.json");

// Create an array to store log messages
const logMessages = [];

// Create a writable stream to the log JSON file
const logStream = fs.createWriteStream(logFilePath, { flags: "a" }); // 'a' flag appends to the file

// Override console.log to capture log messages
console.log = function (data) {
    logMessages.push(data);
    process.stdout.write(data + "\n"); // Also print to the console
};

// Function to save log messages to the JSON file
function saveLogsToFile() {
    fs.writeFileSync(logFilePath, JSON.stringify(logMessages, null, 2));
}

// Handle process exit to save logs before the program exits
process.on("exit", () => {
    saveLogsToFile();
});

function countFoldersInDirectory(directoryPath) {
    try {
        const items = fs.readdirSync(directoryPath);
        let folderCount = 0;

        for (const item of items) {
            const itemPath = path.join(directoryPath, item);
            const itemStat = fs.statSync(itemPath);

            if (itemStat.isDirectory()) {
                folderCount++;
            }
        }

        return folderCount;
    } catch (error) {
        console.error(`Error counting folders in directory: ${directoryPath}`);
        return -1; // You can handle the error accordingly
    }
}

const traverse = function getAllInfoJsonFiles(
    directoryPath,
    parentDirName = "",
    fileArray = []
) {
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const fileStat = fs.statSync(filePath);

        if (fileStat.isDirectory()) {
            if (path.basename(filePath) !== "validators") {
                // If it's a directory (excluding 'validators'), recursively search it
                getAllInfoJsonFiles(
                    filePath,
                    getNameAfterFirstSlash(filePath),
                    fileArray
                );
            }
        } else if (file === "info.json") {
            // If the file name is exactly "info.json", add an object with path, parent directory name, and logo properties to the array
            const logoPath = path.resolve(directoryPath, "logo.png");
            fileArray.push({
                path: path.resolve(filePath),
                parentDirName,
                logo: logoPath,
            });
        }
    }

    return fileArray;
};

function getNameAfterFirstSlash(filePath) {
    const parts = filePath.split("/");
    if (parts.length >= 2) {
        return parts[1]; // Index 1 corresponds to the name after the first /
    } else {
        return null; // Return null or handle the case where there aren't enough slashes
    }
}

function convertJsonFilesToObject(filePaths) {
    const networks = [];
    const tokens = [];
    for (const filePath of filePaths) {
        try {
            const jsonContent = fs.readFileSync(filePath.path, "utf8");
            const jsonObject = JSON.parse(jsonContent);
            jsonObject.chain = filePath.parentDirName;
            jsonObject.logo = filePath.logo;

            if ("id" in jsonObject) {
                tokens.push(jsonObject);
            } else {
                networks.push(jsonObject);
            }
        } catch (error) {
            console.error(
                `Error reading or parsing JSON in file: ${filePath.path}`
            );
        }
    }

    return { networks, tokens };
}

async function findNetwork(name) {
    try {
        const correspondingNetwork = await axios.get(
            `${URL}/api/networks?filters[trustWalletFolderName]=${name}`
        );
        return correspondingNetwork.data.data[0];
    } catch (err) {
        return null;
    }
}

async function findToken(token) {
    try {
        const correspondingToken = await axios.get(
            `${URL}/api/trust-wallet-tokens?filters[trustWalletRepoFolderName]=${token.chain}&filters[address]=${token.id}&populate=*`
        );
        return correspondingToken.data.data[0];
    } catch (err) {
        return null;
    }
}

function compareObjects(a, b) {
    // Get the keys of object A
    const keysA = Object.keys(a);
    // Loop through the keys and compare values with object B
    for (const key of keysA) {
        if (!a[key]) {
            continue;
        }
        if (!(key in b) || a[key] !== b[key]) {
            return false; // Property doesn't exist in B or values are not the same
        }
    }

    return true; // All properties exist in B and have the same values
}

// This function does not compare relations
function isDifferent(data, exist) {
    const attr = exist.attributes;
    return !compareObjects(data, attr);
}

async function updateNetwork(network, id) {
    const updatedNetwork = await axios.put(`${URL}/api/networks/${id}`, {
        data: network,
    });
    return updatedNetwork.data;
}

async function updateToken(token, id) {
    const updatedToken = await axios.put(
        `${URL}/api/trust-wallet-tokens/${id}`,
        {
            data: token,
        }
    );
    return updatedToken.data;
}

function checkFileExists(filePath) {
    return new Promise((resolve) => {
        fs.access(filePath, fs.constants.F_OK, (err) => {
            resolve(!err);
        });
    });
}

async function uploadIcon(iconPath) {
    if (iconPath === null) {
        return null;
    }
    if (!(await checkFileExists(iconPath))) {
        return null;
    }
    const stream = fs.createReadStream(iconPath);
    const formData = new FormData();
    formData.append("files", stream);

    const response = await axios.post(`${URL}/api/upload`, formData, {
        headers: {
            ...formData.getHeaders(),
        },
    });
    return response.data[0].id;
}

async function postNetwork(newNetwork) {
    const netResponse = await axios.post(`${URL}/api/networks`, {
        data: newNetwork,
    });
    const uploadedNetwork = netResponse.data;
    return uploadedNetwork.data.id;
}

async function postToken(newToken) {
    const tokenResponse = await axios.post(`${URL}/api/trust-wallet-tokens`, {
        data: newToken,
    });
    const uploadedToken = tokenResponse.data;
    return uploadedToken.data.id;
}

async function fillNetwork(networks) {
    for (const network of networks) {
        try {
            const exist = await findNetwork(network.name);
            const newNetwork = mapNetwork(network);
            if (exist) {
                const hasChanged = isDifferent(newNetwork, exist);
                if (hasChanged) {
                    const updated = await updateNetwork(newNetwork, exist.id);
                    const toLog = {
                        success: true,
                        status: "UPDATED",
                        id: updated.id,
                        chain: network.chain,
                    };
                    console.log(JSON.stringify(toLog));
                    continue;
                } else {
                    const toLog = {
                        success: true,
                        status: "UNTOUCHED",
                        id: exist.id,
                        chain: network.chain,
                    };
                    console.log(JSON.stringify(toLog));
                    continue;
                }
            }
            // Does not exist
            // Upload icon
            const iconId = await uploadIcon(network.logo);
            newNetwork.icon = iconId;
            const networkId = await postNetwork(newNetwork);
            const toLog = {
                success: true,
                status: "CREATED",
                id: networkId,
                chain: network.chain,
            };
            console.log(JSON.stringify(toLog));
        } catch (error) {
            console.log(
                JSON.stringify({
                    success: false,
                    network: network.chain,
                    error: error,
                })
            );
        }
    }
}

async function fillToken(tokens) {
    for (const token of tokens) {
        try {
            const exist = await findToken(token);
            const newToken = mapToken(token);
            if (exist) {
                const hasChanged = isDifferent(newToken, exist);
                if (hasChanged) {
                    const updated = await updateToken(newToken, exist.id);
                    const toLog = {
                        success: true,
                        status: "UPDATED",
                        id: updated.id,
                        chain: token.chain,
                    };
                    console.log(JSON.stringify(toLog));
                    continue;
                } else if (!exist.attributes.network.data) {
                    // re update network
                    const networkId = await findNetwork(token.chain);
                    const newToken = {
                        network: networkId,
                    };
                    const updated = await updateToken(newToken, exist.id);
                    const toLog = {
                        success: true,
                        status: "NETWORK UPDATED",
                        id: updated.id,
                        chain: token.chain,
                    };
                    console.log(JSON.stringify(toLog));
                    continue;
                } else {
                    const toLog = {
                        success: true,
                        status: "UNTOUCHED",
                        id: exist.id,
                        chain: token.chain,
                    };
                    console.log(JSON.stringify(toLog));
                    continue;
                }
            }
            // Does not exist
            // Upload icon
            const iconId = await uploadIcon(token.logo);
            const networkId = await findNetwork(token.chain);
            newToken.icon = iconId;
            newToken.network = networkId;
            const tokenId = await postToken(newToken);
            const toLog = {
                success: true,
                status: "CREATED",
                id: tokenId,
                chain: token.chain,
            };
            console.log(JSON.stringify(toLog));
        } catch (error) {
            console.log(
                JSON.stringify({
                    success: false,
                    token: token.chain,
                    id: token.id,
                    error: error,
                })
            );
        }
    }
}

function mapNetwork(network) {
    const mapped = {
        name: network.name,
        symbol: network.symbol,
        trustWalletFolderName: network.chain,
    };
    return mapped;
}

function mapToken(token) {
    const mapped = {
        name: token.name,
        symbol: token.symbol,
        address: token.id,
        decimals: token.decimals,
        trustWalletRepoFolderName: token.chain,
    };
    return mapped;
}

async function main() {
    const result = traverse("blockchains");
    const data = convertJsonFilesToObject(result);
    // await fillNetwork(data.networks);
    fillToken(data.tokens);
}

main();
