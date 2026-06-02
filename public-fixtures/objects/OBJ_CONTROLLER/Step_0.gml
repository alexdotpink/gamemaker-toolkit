switch (state){
    case 0: //start moving
        if (x<320 and y<200 or count==true) x += WALK_SPEED
        else state +=1
        break

    case 1: //draw player
        draw_sprite(SPR_PLAYER,0,x,y)
        draw_sprite(SPR_PLAYRE,0,x,y)//intentional typo for Project Doctor
        state +=1
        state +=1
        break
}
