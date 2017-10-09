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

bot.dialog('scheduleAppointment', [
    function (session, args, next) {
        session.userData = {};
        // session.send('Welcome to the Appointment Scheduler! We are analyzing your message: \'%s\'', session.message.text);
        // try extracting entities
        doctorEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'DoctorType');
        timeEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetimeV2.datetime');
        reasonEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'AppointmentReason');        

        if (!doctorEntity) {
            // doctor type entity is not detected, ask for it
            session.beginDialog('askDoctorType');
        }
        else {
            // doctor type entity is detected, isolate doctor type through approximate matching
            a = FuzzySet(['Radiologist', 'Psychologist', 'Cardiologist', 'Dermatologist']);
            // check if doctor user entered is in available set
            if (!a.get(doctorEntity.entity) || a.get(doctorEntity.entity)[0][0] < .5) {
                // not in available set. ask for doctor type
                session.beginDialog('askDoctorType');
            }
            session.userData.doctorType = {};
            session.userData.doctorType.entity = a.get(doctorEntity.entity)[0][1];
            // continue to next step
            next();
        }
    },
    function (session, results, next) {
        if (!timeEntity) {
            // time entity is not detected, ask for it
            session.beginDialog('askTime');
        }
        else {
            session.userData.apptTime = timeEntity;
            next();
        }
    },
    function(session, results, next) {
        if (!reasonEntity) {
            // reason entity is not detected, continue to next step
            session.beginDialog('askReason');
        }
        else {
            session.userData.apptReason = reasonEntity;            
        }
        next();
    },
    function(session, results, next) {
        session.send('Alright! Your appointment is scheduled with a ' + session.userData.doctorType.entity + 
        ' for ' + session.userData.apptTime.entity +
            ' for the reason: ' + session.userData.apptReason.entity);
        session.send("Thanks!");
    }
]).triggerAction({
    matches: 'ScheduleAppointment',
    intentThreshold: .5
});

bot.dialog('askDoctorType', [
    function(session, args) {
        builder.Prompts.choice(session,'What type of doctor you would like to see?',
            ['Radiologist', 'Psychiatrist', 'Cardiologist', 'Dermatologist'],
            { listStyle: builder.ListStyle.button });
    },
    function(session, args, next) {
        const doctorType = args.response.entity;
        if(!doctorType) session.replaceDialog('askDoctorType', { reprompt: true });
        else {
            session.userData.doctorType = {};
            session.userData.doctorType.entity = doctorType;
            session.endDialog();      
        }  
    }
]);

bot.dialog('askTime', [
    function(session, args) {
        builder.Prompts.time(session,'When would you like to schedule the appointment?');
    },
    function(session, args, next) {
        const time = args.response.entity;
        console.log(builder.EntityRecognizer.parseTime(time));                   
        if(!time) session.replaceDialog('askTime', { reprompt: true });
        else {
            session.userData.apptTime = {}
            session.userData.apptTime.entity = time;
            session.endDialog();
        }
    }
]);

bot.dialog('askReason', [
    function(session) {
        builder.Prompts.text(session,'What is the reason for the appointment?');
    },
    function(session, results) {
        // reasonEntity = builder.EntityRecognizer.findEntity(results.response, 'AppointmentReason');
        // session.send(results.response);
        session.userData.apptReason = {};
        session.userData.apptReason.entity = results.response;
        session.endDialog();
    }
]);

bot.dialog('Help', function (session) {
    session.endDialog('Hi! Try asking me things like \'schedule an appointment\'');
}).triggerAction({
    matches: 'Help',
    intentThreshold: .5
});

bot.dialog('Cancel', function (session) {
    session.endDialog('Appointment scheduling canceled.');
}).triggerAction({
    matches: 'Cancel',
    intentThreshold: .5
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