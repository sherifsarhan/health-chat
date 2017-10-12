// Author: Sherif Sarhan
// Date: 10/9/2017
// This loads the environment variables from the .env file
require('dotenv-extended').load();

var builder = require('botbuilder');
var restify = require('restify');
var Store = require('./store');
var spellService = require('./spell-service');
var FuzzySet = require('fuzzyset.js');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});
// Create connector and listen for messages
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector, function (session) {
    session.send('Sorry, I did not understand \'%s\'. Type \'help\' if you need assistance.', session.message.text);
});

// You can provide your own model by specifing the 'LUIS_MODEL_URL' environment variable
// This Url can be obtained by uploading or creating your model from the LUIS portal: https://www.luis.ai/
var recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL);
bot.recognizer(recognizer);

var doctorEntity;
var timeEntity;
var reasonEntity;
const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
const dateOptionsShort = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
const timeOptionsShort = { hour: '2-digit', minute: '2-digit' };
var doctorsSchedule = {
    Radiologist: {
        2017: {
            9: {
                12: {
                    9: {
                        0: 'booked',
                        30: 'available'
                    },
                    10: {
                        0: 'available',
                        0: 'available'
                    },
                    14: {
                        0: 'booked',
                        30: 'available'
                    },
                    15: {
                        0: 'available'
                    }
                },
                13: {
                    14: {
                        0: 'booked',
                        30: 'available'
                    },
                    15: {
                        0: 'available'
                    }
                }
            }
        }
    }
}

bot.dialog('scheduleAppointment', [
    function (session, args, next) {
        session.userData = {};
        // session.send('Welcome to the Appointment Scheduler! We are analyzing your message: \'%s\'', session.message.text);
        // try extracting entities
        session.userData.doctorEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'DoctorType');
        session.userData.timeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.datetime');
        session.userData.reasonEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'AppointmentReason');

        if (!session.userData.doctorEntity) {
            // doctor type entity is not detected, ask for it
            session.beginDialog('askDoctorType');
        }
        else {
            // doctor type entity is detected, isolate doctor type through approximate matching
            a = FuzzySet(['Radiologist', 'Psychologist', 'Cardiologist', 'Dermatologist']);
            // check if doctor user entered is in available set
            if (!a.get(session.userData.doctorEntity.entity) || a.get(session.userData.doctorEntity.entity)[0][0] < .5) {
                // not in available set. ask for doctor type
                session.beginDialog('askDoctorType');
            }
            session.userData.doctorType = a.get(session.userData.doctorEntity.entity)[0][1];
            next();
        }
    },
    function (session, args, next) {
        if (!session.userData.timeEntity) {
            // time entity is not detected, ask for it
            session.beginDialog('askTime');
        }
        else {
            session.beginDialog('askTime', { noprompt: true })
        }
    },
    function (session, args, next) {
        if (!session.userData.reasonEntity) {
            // reason entity is not detected, continue to next step
            session.beginDialog('askReason');
        }
        else {
            session.userData.apptReason = session.userData.reasonEntity;
            next();
        }
    },
    function (session) {
        session.send('Alright! Your appointment is scheduled with a ' + session.userData.doctorType +
            ' for ' + session.userData.apptTime.entity);
        session.send("Thanks!");
    }
]).triggerAction({
    matches: 'ScheduleAppointment',
    intentThreshold: .65
});

bot.dialog('askDoctorType', [
    function (session, args) {
        builder.Prompts.choice(session, 'What type of doctor you would like to see?',
            ['Radiologist', 'Psychiatrist', 'Cardiologist', 'Dermatologist'],
            { listStyle: builder.ListStyle.button });
    },
    function (session, args) {
        const doctorType = args.response.entity;
        if (!doctorType) session.replaceDialog('askDoctorType', { reprompt: true });
        else {
            session.userData.doctorType = doctorType;
            session.endDialog();
        }
    }
]);

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}

function isTimeslotAvailable(session, requestedDate) {
    let apptDatePath = doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getMonth()]
    [requestedDate.getDate()][requestedDate.getHours()];
    if (apptDatePath[requestedDate.getMinutes()] == 'available') {
        apptDatePath[requestedDate.getMinutes()] = 'booked';
        return true; 
    }
    return false;
}

function getAvailableTimeslots(session) {
    let requestedDate = session.userData.requestedDate;
    let apptHours = doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getMonth()]
    [requestedDate.getDate()];
    let availableTimeslots = [];
    for (let hour in apptHours) {
        if (apptHours.hasOwnProperty(hour)) {
            let minutes = apptHours[hour];
            for (let minute in minutes) {
                if (apptHours[hour][minute] == 'available') {
                    let timeslot = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), requestedDate.getDate(), hour, minute);
                    availableTimeslots.push(timeslot);
                }
            }
        }
    }
    return availableTimeslots;
}

bot.dialog('askTime', [
    function (session, args, next) {
        if (args && args.reprompt) {
            builder.Prompts.time(session, 'Please provide increments of 30 minutes only. (Examples: 1:30PM, 2:00PM, 2:30PM');
        }
        else if (args && args.noprompt) {
            next({ noprompt: true });
        }
        else {
            builder.Prompts.time(session, 'When would you like to schedule the appointment? Provide increments of 30 minutes only. (Examples: 1:30PM, 2:00PM, 2:30PM');
        }
    },
    function (session, args) {
        const time = args.noprompt ? session.userData.timeEntity.entity : args.response.entity;
        if (!time) session.replaceDialog('askTime', { reprompt: true });
        else {
            // returns date object
            let exactTime = builder.EntityRecognizer.parseTime(time);

            // TODO: check if date is given but not time

            // add 30 mins to date
            // only accept if minutes == 0 or minutes === 30
            // reprompt if date is not increment of 30
            if (!(exactTime.getMinutes() == 0 || exactTime.getMinutes() == 30)) {
                session.replaceDialog('askTime', { reprompt: true });
            }

            // check if date is available in doctor's calendar
            let isAvailable = isTimeslotAvailable(session, exactTime);
            if (!isAvailable) {
                // try to find another time/day that works
                session.userData.requestedDate = exactTime;
                session.replaceDialog('timeslotUnavailable');
            }
            else {       
                // get date string. ex: Wednesday, October 11, 2017, 2:00 PM
                exactTime = exactTime.toLocaleTimeString("en-us", dateOptions);

                session.userData.apptTime = exactTime;
                session.endDialog();
            }
        }
    }
]);

bot.dialog('timeslotUnavailable', [
    function (session, args) {
        session.send('Sorry, that time slot is booked.');
        
        builder.Prompts.choice(session, `Would you like to view available times for ${session.userData.requestedDate.toLocaleDateString('en-US', dateOptionsShort)} or pick a different day?`,
            [`View times for ${session.userData.requestedDate.toLocaleDateString('en-US', dateOptionsShort)}`,
            'Pick a different day'
            ],
            { listStyle: builder.ListStyle.button });
    },
    function (session, args) {
        // need to create new date object because the one in userData got serialized
        let date = new Date(session.userData.requestedDate);
        session.userData.requestedDate = date;
        if (args.response.index == 0) {
            let availableTimeslots = getAvailableTimeslots(session);
            session.replaceDialog('askDifferentTimes', { availableTimeslots })
        }
        else if (args.response.index == 1) {
            
        }
    }
]);

bot.dialog('askDifferentTimes', [
    function (session, args) {
        let timeslotStrings = []
        args.availableTimeslots.forEach((timeslot) => timeslotStrings.push(timeslot.toLocaleTimeString('en-US', timeOptionsShort)));

        builder.Prompts.choice(session, 'Which one of these times would you prefer?',
            timeslotStrings,
            { listStyle: builder.ListStyle.button });
    },
    function (session, args) {
        if (args.response.index == 0) {
            // mark it as booked
        }
        else if (args.response.index == 1) {
            
        }
    }
]);

bot.dialog('askReason', [
    function (session) {
        builder.Prompts.text(session, 'What is the reason for the appointment?');
    },
    function (session, results) {
        session.userData.apptReason = results.response;
        session.endDialog();
    }
]);

bot.dialog('Help', function (session) {
    session.endDialog('Hi! Try asking me things like \'schedule an appointment\'');
}).triggerAction({
    matches: ['Hello', 'Help'],
    intentThreshold: .65
});

bot.dialog('Cancel', function (session) {
    session.endDialog('Appointment scheduling canceled.');
}).triggerAction({
    matches: 'Cancel',
    intentThreshold: .65
});

// Spell Check
if (process.env.IS_SPELL_CORRECTION_ENABLED === 'true') {
    bot.use({
        botbuilder: function (session, next) {
            spellService
                .getCorrectedText(session.message.text)
                .then(function (text) {
                    session.message.text = text;
                    next();
                })
                .catch(function (error) {
                    console.error(error);
                    next();
                });
        }
    });
}