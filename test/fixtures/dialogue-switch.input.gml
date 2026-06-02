switch (fase){
    case 2: //Waits for swami to pass a certain point
        if (Swami_X < 1600) Tabris_X = 1850
        else fase +=1
        break

    case 7:
        Mewo_Y = ((46/2025)*(Mewo_X-3429)*(Mewo_X-3429)+266)
        if (Mewo_Y<= Mewo_Initial_Y) Mewo_X -= 2 //move mewo
        else fase+=1
        break
}
